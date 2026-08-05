import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { publicKeyToAddress } from 'viem/accounts';

import { getServerEnv } from '@/server/config/env';
import { ApiError } from '@/server/transport/http/api-error';

export type VerifiedWeb3AuthIdentity = {
  readonly subject: string;
  readonly walletAddress: string;
  readonly email: string | null;
  readonly name: string | null;
};

type WalletClaim = {
  readonly type?: unknown;
  readonly curve?: unknown;
  readonly public_key?: unknown;
  readonly address?: unknown;
};

const DEFAULT_JWKS_URLS = [
  'https://api.web3auth.io/citadel-service/.well-known/jwks.json',
  'https://api-auth.web3auth.io/jwks',
  'https://authjs.web3auth.io/jwks',
] as const;

const DEFAULT_ISSUERS = [
  'web3auth.io',
  'https://api-auth.web3auth.io',
  'https://authjs.web3auth.io',
] as const;

function normalizeHexAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(trimmed)) {
    throw new ApiError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Verified identity did not include a valid EVM address.',
      status: 401,
    });
  }
  return trimmed;
}

function asWalletClaims(payload: JWTPayload): WalletClaim[] {
  const wallets = payload['wallets'];
  if (!Array.isArray(wallets)) {
    return [];
  }
  return wallets.filter(
    (entry): entry is WalletClaim =>
      typeof entry === 'object' && entry !== null,
  );
}

function addressFromSecp256k1PublicKey(publicKey: string): string | null {
  const normalized = publicKey.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]+$/.test(normalized)) {
    return null;
  }
  // Compressed (33 bytes / 66 hex) or uncompressed (65 bytes / 130 hex).
  if (normalized.length !== 66 && normalized.length !== 130) {
    return null;
  }
  try {
    return publicKeyToAddress(`0x${normalized}`).toLowerCase();
  } catch {
    return null;
  }
}

function resolveSubject(payload: JWTPayload): string {
  const userId = payload['userId'];
  if (typeof userId === 'string' && userId.length > 0) {
    return userId;
  }
  if (typeof payload.sub === 'string' && payload.sub.length > 0) {
    return payload.sub;
  }
  const email = payload['email'];
  if (typeof email === 'string' && email.length > 0) {
    return email;
  }
  throw new ApiError({
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Identity token is missing a subject.',
    status: 401,
  });
}

function extractWalletAddress(
  payload: JWTPayload,
  claimedAddress: string,
): string {
  const wanted = normalizeHexAddress(claimedAddress);
  const wallets = asWalletClaims(payload);

  // Accept any wallets[].address (Web3Auth v2 may omit type, or use
  // walletPublicAddress / app-key EVM address rather than provider eoaAddress).
  for (const wallet of wallets) {
    if (typeof wallet.address === 'string') {
      if (wallet.address.trim().toLowerCase() === wanted) {
        return wanted;
      }
    }
  }

  for (const wallet of wallets) {
    if (
      (wallet.type === 'web3auth_app_key' || wallet.type === 'ethereum') &&
      wallet.curve === 'secp256k1' &&
      typeof wallet.public_key === 'string'
    ) {
      const derived = addressFromSecp256k1PublicKey(wallet.public_key);
      if (derived === wanted) {
        return wanted;
      }
    }
  }

  // Curve may be omitted on some app-key entries.
  for (const wallet of wallets) {
    if (
      wallet.type === 'web3auth_app_key' &&
      typeof wallet.public_key === 'string'
    ) {
      const derived = addressFromSecp256k1PublicKey(wallet.public_key);
      if (derived === wanted) {
        return wanted;
      }
    }
  }

  throw new ApiError({
    code: 'ACCESS_DENIED',
    message: 'Wallet address is not owned by the verified Web3Auth identity.',
    status: 403,
    details: {
      claimedWalletAddress: wanted,
      boundWalletCount: wallets.length,
    },
  });
}

export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
  if (authorizationHeader === null) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (match === null) {
    return null;
  }
  const token = match[1]?.trim();
  return token !== undefined && token.length > 0 ? token : null;
}

/**
 * Verify Web3Auth identity token and that claimedAddress is bound to it.
 * Mock path (ALLOW_MOCK_ADAPTERS): Bearer `mock:0x…` proves address only.
 */
export async function verifyWeb3AuthIdentity(input: {
  authorizationHeader: string | null;
  claimedWalletAddress: string;
}): Promise<VerifiedWeb3AuthIdentity> {
  const token = extractBearerToken(input.authorizationHeader);
  if (token === null) {
    throw new ApiError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authorization Bearer token is required.',
      status: 401,
    });
  }

  const env = getServerEnv();
  const claimed = normalizeHexAddress(input.claimedWalletAddress);

  if (env.ALLOW_MOCK_ADAPTERS && token.toLowerCase().startsWith('mock:')) {
    const mockAddress = normalizeHexAddress(token.slice('mock:'.length));
    if (mockAddress !== claimed) {
      throw new ApiError({
        code: 'ACCESS_DENIED',
        message: 'Mock identity address does not match claimed wallet.',
        status: 403,
      });
    }
    return {
      subject: `mock:${mockAddress}`,
      walletAddress: mockAddress,
      email: null,
      name: null,
    };
  }

  const audience = env.WEB3AUTH_CLIENT_ID;
  if (audience === undefined || audience.length === 0) {
    throw new ApiError({
      code: 'SERVICE_UNAVAILABLE',
      message:
        'WEB3AUTH_CLIENT_ID is not configured for identity verification.',
      status: 503,
    });
  }

  const jwksUrls =
    env.WEB3AUTH_JWKS_URLS !== undefined && env.WEB3AUTH_JWKS_URLS.length > 0
      ? env.WEB3AUTH_JWKS_URLS.split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [...DEFAULT_JWKS_URLS];

  let payload: JWTPayload | undefined;
  let lastError: unknown;
  for (const jwksUrl of jwksUrls) {
    try {
      const jwks = createRemoteJWKSet(new URL(jwksUrl));
      const verified = await jwtVerify(token, jwks, {
        algorithms: ['ES256'],
        audience,
        issuer: [...DEFAULT_ISSUERS],
        clockTolerance: 60,
      });
      payload = verified.payload;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (payload === undefined) {
    throw new ApiError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Web3Auth identity token could not be verified.',
      status: 401,
      details: {
        reason:
          lastError instanceof Error
            ? lastError.message
            : 'verification_failed',
      },
    });
  }

  const walletAddress = extractWalletAddress(payload, claimed);
  const email = typeof payload['email'] === 'string' ? payload['email'] : null;
  const name = typeof payload['name'] === 'string' ? payload['name'] : null;

  return {
    subject: resolveSubject(payload),
    walletAddress,
    email,
    name,
  };
}
