/**
 * Client-side helpers for Web3Auth id tokens.
 * Does not verify the JWT — server verification remains authoritative.
 */
import { publicKeyToAddress } from 'viem/accounts';

function normalizeHexAddress(value: string): string | null {
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

/**
 * Decode JWT payload (unverified) and collect EVM addresses Web3Auth binds
 * (`wallets[].address` and secp256k1 app keys).
 */
export function ownedEvmAddressesFromIdToken(idToken: string): string[] {
  const parts = idToken.split('.');
  if (parts.length < 2 || parts[1] === undefined) {
    return [];
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as {
      wallets?: ReadonlyArray<{
        type?: unknown;
        curve?: unknown;
        address?: unknown;
        public_key?: unknown;
      }>;
    };
    const owned = new Set<string>();
    for (const wallet of payload.wallets ?? []) {
      if (typeof wallet.address === 'string') {
        const address = normalizeHexAddress(wallet.address);
        if (address !== null) {
          owned.add(address);
        }
      }
      if (
        wallet.type === 'web3auth_app_key' &&
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
  } catch {
    return [];
  }
}

/**
 * Prefer the connected session address when it appears in the id token;
 * otherwise use the first bound EVM address (Web3Auth app/EVM wallet).
 */
export function resolveWalletAddressForOnboarding(input: {
  idToken: string;
  sessionAddress: string;
}): string {
  const session = normalizeHexAddress(input.sessionAddress);
  if (session === null) {
    throw new Error('Connected wallet address is invalid.');
  }
  const owned = ownedEvmAddressesFromIdToken(input.idToken);
  if (owned.length === 0 || owned.includes(session)) {
    return session;
  }
  const bound = owned[0];
  return bound ?? session;
}
