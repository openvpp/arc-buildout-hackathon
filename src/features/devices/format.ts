import { env } from '@/config/env';

export function deviceDisplayName(device: {
  readonly displayName: string | null;
  readonly externalDeviceId: string;
}): string {
  return device.displayName ?? device.externalDeviceId;
}

/** True when the value is an EVM transaction hash Arcscan can open. */
export function isOnchainTxHash(value: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

/** Arc explorer URL for a transaction hash (payment, mint, etc.). */
export function arcTxExplorerUrl(txHash: string): string {
  return `${env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL.replace(/\/$/, '')}/tx/${txHash}`;
}

export function truncateHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 1) {
    return hash;
  }
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatTimestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function readDeviceMetadata(metadata: Record<string, unknown> | null): {
  readonly year: string | null;
  readonly provider: string | null;
} {
  if (metadata === null) {
    return { year: null, provider: null };
  }
  const year = metadata['year'];
  const provider = metadata['provider'];
  return {
    year:
      typeof year === 'number' || typeof year === 'string'
        ? String(year)
        : null,
    provider: typeof provider === 'string' ? provider : null,
  };
}

export function deviceStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') {
    return 'success';
  }
  if (status === 'inactive') {
    return 'warning';
  }
  if (status === 'disconnected') {
    return 'danger';
  }
  return 'neutral';
}

export function mintStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'minted') {
    return 'success';
  }
  if (status === 'pending') {
    return 'info';
  }
  if (status === 'failed') {
    return 'danger';
  }
  return 'neutral';
}
