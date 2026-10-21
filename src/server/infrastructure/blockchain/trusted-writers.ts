import { isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type { ServerEnv } from '@/server/config/env';
import { resolveDeviceNftMinterPrivateKey } from '@/server/infrastructure/blockchain/network-provider';

/**
 * Writer addresses whose anchors verification accepts, lowercased.
 * ARC_TRUSTED_WRITER_ADDRESSES if set, else this app's own signer. Invalid
 * entries are ignored rather than trusted.
 */
export function resolveTrustedWriters(env: ServerEnv): string[] {
  const configured = env.ARC_TRUSTED_WRITER_ADDRESSES.split(',')
    .map((value) => value.trim())
    .filter((value) => isAddress(value))
    .map((value) => value.toLowerCase());
  if (configured.length > 0) {
    return [...new Set(configured)];
  }
  const key = resolveDeviceNftMinterPrivateKey(env);
  return key === null ? [] : [privateKeyToAccount(key).address.toLowerCase()];
}
