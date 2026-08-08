import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { resolveIdentityWalletAddress } from '@/lib/auth/web3auth-wallet-claims';
import { getServerEnv } from '@/server/config/env';
import { ApiError } from '@/server/transport/http/api-error';

export type VerifiedWeb3AuthIdentity = {
  readonly subject: string;
  readonly walletAddress: string;
  readonly email: string | null;
  readonly name: string | null;
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
  claimedAddress: string | null,
): string {
  try {
    return resolveIdentityWalletAddress({
      payload,
      claimedAddress,
    }).address;
  } catch {
    throw new ApiError({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Web3Auth identity token has no bound EVM wallet.',
      status: 401,
      details: {
        claimedWalletAddress: claimedAddress,
      },
    });
  }
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
 * Verify Web3Auth identity token.
 * Wallet identity comes from the JWT (`wallets` claims). An optional claimed
 * address is used only when it is attested in the token; otherwise the primary
 * JWT-bound address is used as the wallet identity source of truth.
 */
export async function verifyWeb3AuthIdentity(input: {
  authorizationHeader: string | null;
  claimedWalletAddress?: string | null;
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
  const claimed =
    input.claimedWalletAddress !== undefined &&
    input.claimedWalletAddress !== null &&
    input.claimedWalletAddress.trim().length > 0
      ? normalizeHexAddress(input.claimedWalletAddress)
      : null;

  if (env.ALLOW_MOCK_ADAPTERS && token.toLowerCase().startsWith('mock:')) {
    const mockAddress = normalizeHexAddress(token.slice('mock:'.length));
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
