import { type Chain, http } from 'viem';

import {
  arcNetworkDisplayName,
  arcNetworkLabel as arcNetworkLabelFor,
  defaultArcRpcUrl,
} from '@/config/arc-network';
import type { ServerEnv } from '@/server/config/env';

/** Stored on `devices.network`, e.g. `arc-mainnet-5042`. */
export function arcNetworkLabel(env: ServerEnv): string {
  return arcNetworkLabelFor(env.ARC_CHAIN_ID);
}

/** ARC_RPC_URL, or Arc's public RPC for this chain; never another chain's RPC. */
export function resolveArcRpcUrl(env: ServerEnv): string {
  if (env.ARC_RPC_URL !== undefined && env.ARC_RPC_URL.length > 0) {
    return env.ARC_RPC_URL;
  }
  const fallback = defaultArcRpcUrl(env.ARC_CHAIN_ID);
  if (fallback === null) {
    throw new Error(
      `ARC_RPC_URL is required for ARC_CHAIN_ID ${env.ARC_CHAIN_ID}.`,
    );
  }
  return fallback;
}

export function createArcMintChain(env: ServerEnv): Chain {
  return {
    id: Number(env.ARC_CHAIN_ID),
    name: arcNetworkDisplayName(env.ARC_CHAIN_ID),
    // Arc's gas token is USDC, 18 decimals at the native level.
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 18 },
    rpcUrls: {
      default: { http: [resolveArcRpcUrl(env)] },
    },
  };
}

export function createArcHttpTransport(
  env: ServerEnv,
  options: { timeout?: number; retryCount?: number } = {},
) {
  const url = resolveArcRpcUrl(env);
  const authToken = env.ARC_AUTH_TOKEN;
  return http(url, {
    ...options,
    fetchOptions:
      authToken !== undefined && authToken.length > 0
        ? { headers: { Authorization: `Bearer ${authToken}` } }
        : undefined,
  });
}

export function resolveDeviceNftMinterPrivateKey(
  env: ServerEnv,
): `0x${string}` | null {
  const key = env.DEVICE_NFT_MINTER_PRIVATE_KEY ?? env.PRIVATE_KEY;
  if (key === undefined || key.length === 0) {
    return null;
  }
  const normalized = key.startsWith('0x') ? key : `0x${key}`;
  return normalized as `0x${string}`;
}

export function isDeviceNftMintConfigured(env: ServerEnv): boolean {
  return (
    env.USE_ARC_NETWORK &&
    env.DEVICE_NFT_CONTRACT_ADDRESS !== undefined &&
    env.DEVICE_NFT_CONTRACT_ADDRESS.length > 0 &&
    resolveDeviceNftMinterPrivateKey(env) !== null
  );
}

/** RPC for verification reads: VERIFIER_RPC_URL, else the main Arc RPC. */
export function resolveVerifierRpcUrl(env: ServerEnv): string {
  return env.VERIFIER_RPC_URL !== undefined && env.VERIFIER_RPC_URL.length > 0
    ? env.VERIFIER_RPC_URL
    : resolveArcRpcUrl(env);
}
