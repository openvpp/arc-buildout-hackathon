import { privateKeyToAccount } from 'viem/accounts';

import { trustedWriterEntries, type ServerEnv } from '@/server/config/env';
import { resolveDeviceNftMinterPrivateKey } from '@/server/infrastructure/blockchain/network-provider';

/**
 * Writer addresses whose anchors verification accepts, lowercased.
 * ARC_TRUSTED_WRITER_ADDRESSES (validated at startup, any letter case) if
 * set; otherwise — outside staging/production, where the list is required —
 * this app's own signer.
 */
export function resolveTrustedWriters(env: ServerEnv): string[] {
  const configured = trustedWriterEntries(env.ARC_TRUSTED_WRITER_ADDRESSES).map(
    (value) => value.toLowerCase(),
  );
  if (configured.length > 0) {
    return [...new Set(configured)];
  }
  const key = resolveDeviceNftMinterPrivateKey(env);
  return key === null ? [] : [privateKeyToAccount(key).address.toLowerCase()];
}
