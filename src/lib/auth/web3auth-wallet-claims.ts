/**
 * Pure helpers to read EVM addresses from a Web3Auth id-token payload.
 * Client decode is unverified; server must still jwtVerify before trust.
 */
import { publicKeyToAddress } from 'viem/accounts';

export function normalizeEvmHexAddress(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(trimmed) ? trimmed : null;
}

function addressFromSecp256k1PublicKey(publicKey: string): string | null {
  const normalized = publicKey.trim().toLowerCase().replace(/^0x/, '');
  if (normalized.length !== 66 && normalized.length !== 130) {
    return null;
  }
  if (!/^[0-9a-f]+$/.test(normalized)) {
    return null;
  }
  try {
    return publicKeyToAddress(`0x${normalized}`).toLowerCase();
  } catch {
    return null;
  }
}

type WalletClaim = {
  readonly type?: unknown;
  readonly curve?: unknown;
  readonly public_key?: unknown;
  readonly address?: unknown;
};

function asWalletClaims(payload: Record<string, unknown>): WalletClaim[] {
  const wallets = payload['wallets'];
  if (!Array.isArray(wallets)) {
    return [];
  }
  return wallets.filter(
    (entry): entry is WalletClaim =>
      typeof entry === 'object' && entry !== null,
  );
}

/** Collect EVM addresses attested in a Web3Auth JWT payload. */
export function ownedEvmAddressesFromPayload(
  payload: Record<string, unknown>,
): string[] {
  const owned = new Set<string>();
  for (const wallet of asWalletClaims(payload)) {
    if (typeof wallet.address === 'string') {
      const address = normalizeEvmHexAddress(wallet.address);
      if (address !== null) {
        owned.add(address);
      }
    }
    const isAppKey = wallet.type === 'web3auth_app_key';
    const isEthereum = wallet.type === 'ethereum';
    if (
      (isAppKey || isEthereum) &&
      typeof wallet.public_key === 'string' &&
      (wallet.curve === 'secp256k1' || wallet.curve === undefined)
    ) {
      const derived = addressFromSecp256k1PublicKey(wallet.public_key);
      if (derived !== null) {
        owned.add(derived);
      }
    }
    // Some tokens omit type but still carry a secp256k1 app public key.
    if (
      wallet.type === undefined &&
      typeof wallet.public_key === 'string' &&
      (wallet.curve === 'secp256k1' || wallet.curve === undefined)
    ) {
      const derived = addressFromSecp256k1PublicKey(wallet.public_key);
      if (derived !== null) {
        owned.add(derived);
      }
    }
  }
  return [...owned];
}

/**
 * Prefer an optional claimed/session address when it is attested in the token;
 * otherwise use the first JWT-bound EVM address (source of truth).
 */
export function resolveIdentityWalletAddress(input: {
  readonly payload: Record<string, unknown>;
  readonly claimedAddress?: string | null;
}): { readonly address: string; readonly ownedAddresses: readonly string[] } {
  const owned = ownedEvmAddressesFromPayload(input.payload);
  if (owned.length === 0) {
    throw new Error('Web3Auth identity token has no bound EVM wallet.');
  }
  const claimed =
    input.claimedAddress !== undefined &&
    input.claimedAddress !== null &&
    input.claimedAddress.trim().length > 0
      ? normalizeEvmHexAddress(input.claimedAddress)
      : null;
  if (claimed !== null && owned.includes(claimed)) {
    return { address: claimed, ownedAddresses: owned };
  }
  const primary = owned[0];
  if (primary === undefined) {
    throw new Error('Web3Auth identity token has no bound EVM wallet.');
  }
  return { address: primary, ownedAddresses: owned };
}

/** Unverified JWT payload decode (browser or Node). */
export function decodeJwtPayloadUnsafe(
  idToken: string,
): Record<string, unknown> | null {
  const parts = idToken.split('.');
  if (parts.length < 2 || parts[1] === undefined) {
    return null;
  }
  try {
    const segment = parts[1];
    const json =
      typeof Buffer !== 'undefined'
        ? Buffer.from(segment, 'base64url').toString('utf8')
        : atob(
            segment
              .replace(/-/g, '+')
              .replace(/_/g, '/')
              .padEnd(Math.ceil(segment.length / 4) * 4, '='),
          );
    const payload: unknown = JSON.parse(json);
    if (payload === null || typeof payload !== 'object') {
      return null;
    }
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function ownedEvmAddressesFromIdToken(idToken: string): string[] {
  const payload = decodeJwtPayloadUnsafe(idToken);
  if (payload === null) {
    return [];
  }
  return ownedEvmAddressesFromPayload(payload);
}

export function resolveWalletAddressForOnboarding(input: {
  readonly idToken: string;
  readonly sessionAddress?: string | null;
}): string {
  const payload = decodeJwtPayloadUnsafe(input.idToken);
  if (payload === null) {
    throw new Error('Web3Auth identity token payload is invalid.');
  }
  return resolveIdentityWalletAddress({
    payload,
    ...(input.sessionAddress !== undefined
      ? { claimedAddress: input.sessionAddress }
      : {}),
  }).address;
}
