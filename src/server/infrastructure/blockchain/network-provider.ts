import { type Chain, http } from 'viem';

import type { ServerEnv } from '@/server/config/env';

export function arcNetworkLabel(env: ServerEnv): string {
  return `arc-testnet-${env.ARC_CHAIN_ID}`;
}

export function createArcMintChain(env: ServerEnv): Chain {
  return {
    id: Number(env.ARC_CHAIN_ID),
    name: 'Arc Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'] },
    },
  };
}

export function createArcHttpTransport(env: ServerEnv) {
  const url = env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network';
  const authToken = env.ARC_AUTH_TOKEN;
  return http(url, {
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
