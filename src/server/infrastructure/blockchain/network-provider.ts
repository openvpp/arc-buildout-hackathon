import { defineChain } from 'viem';

import { ARC_TESTNET_CHAIN_ID } from '@/server/config/circle';
import { getServerEnv, type ServerEnv } from '@/server/config/env';

export type MintNetworkKind = 'arc' | 'unavailable';

/**
 * Mirrors ovpp NetworkProvider selection for DeviceNFT minting.
 * Arc is selected only when USE_ARC_NETWORK && ARC_RPC_URL && ARC_AUTH_TOKEN.
 */
export function resolveDeviceNftNetwork(
  env: ServerEnv = getServerEnv(),
): MintNetworkKind {
  if (
    env.USE_ARC_NETWORK &&
    env.ARC_RPC_URL !== undefined &&
    env.ARC_RPC_URL.length > 0 &&
    env.ARC_AUTH_TOKEN !== undefined &&
    env.ARC_AUTH_TOKEN.length > 0
  ) {
    return 'arc';
  }
  return 'unavailable';
}

export function resolveDeviceNftMinterPrivateKey(
  env: ServerEnv = getServerEnv(),
): `0x${string}` | null {
  const raw =
    env.DEVICE_NFT_MINTER_PRIVATE_KEY !== undefined &&
    env.DEVICE_NFT_MINTER_PRIVATE_KEY.length > 0
      ? env.DEVICE_NFT_MINTER_PRIVATE_KEY
      : env.PRIVATE_KEY !== undefined && env.PRIVATE_KEY.length > 0
        ? env.PRIVATE_KEY
        : null;
  if (raw === null) {
    return null;
  }
  const normalized = raw.trim().startsWith('0x')
    ? raw.trim()
    : `0x${raw.trim()}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error(
      'DeviceNFT minter key must be a 32-byte hex private key (PRIVATE_KEY or DEVICE_NFT_MINTER_PRIVATE_KEY)',
    );
  }
  return normalized as `0x${string}`;
}

export function isDeviceNftMintConfigured(
  env: ServerEnv = getServerEnv(),
): boolean {
  if (resolveDeviceNftNetwork(env) !== 'arc') {
    return false;
  }
  if (
    env.DEVICE_NFT_CONTRACT_ADDRESS === undefined ||
    env.DEVICE_NFT_CONTRACT_ADDRESS.length === 0
  ) {
    return false;
  }
  try {
    return resolveDeviceNftMinterPrivateKey(env) !== null;
  } catch {
    return false;
  }
}

export function createArcMintChain(env: ServerEnv = getServerEnv()) {
  const chainId = env.ARC_CHAIN_ID ?? Number(ARC_TESTNET_CHAIN_ID);
  const rpcUrl = env.ARC_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error('ARC_RPC_URL is required for Arc DeviceNFT minting');
  }
  return defineChain({
    id: chainId,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
  });
}

export function arcNetworkLabel(env: ServerEnv = getServerEnv()): string {
  const chainId = env.ARC_CHAIN_ID ?? Number(ARC_TESTNET_CHAIN_ID);
  return `arc-testnet:${chainId}`;
}
