import { describe, expect, it } from 'vitest';

import {
  arcTxExplorerUrl,
  deviceDisplayName,
  deviceStatusTone,
  isOnchainTxHash,
  mintStatusTone,
  readDeviceMetadata,
  truncateHash,
} from '@/features/devices';
import { TELEMETRY_HISTORY_LIMIT } from '@/server/application/dashboard/list-dashboard';

describe('device format helpers', () => {
  it('falls back to external id when display name is missing', () => {
    expect(
      deviceDisplayName({
        displayName: null,
        externalDeviceId: 'enode-vehicle-1',
      }),
    ).toBe('enode-vehicle-1');
  });

  it('reads year and provider from metadata', () => {
    expect(
      readDeviceMetadata({ year: 2024, provider: 'enode', other: true }),
    ).toEqual({ year: '2024', provider: 'enode' });
    expect(readDeviceMetadata(null)).toEqual({ year: null, provider: null });
  });

  it('maps status tones', () => {
    expect(deviceStatusTone('active')).toBe('success');
    expect(deviceStatusTone('disconnected')).toBe('danger');
    expect(mintStatusTone('minted')).toBe('success');
    expect(mintStatusTone('failed')).toBe('danger');
  });

  it('detects on-chain transaction hashes', () => {
    expect(
      isOnchainTxHash(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(true);
    expect(isOnchainTxHash('b887267c-04ff-4bc9-8c1e-6d0c053119b2')).toBe(false);
  });

  it('builds Arc explorer tx URLs', () => {
    expect(arcTxExplorerUrl('0xabc')).toBe(
      'https://explorer.test.example/tx/0xabc',
    );
  });

  it('truncates long hashes', () => {
    expect(truncateHash('abcdefghijXXXXXXmnopqr', 10, 6)).toBe(
      'abcdefghij…mnopqr',
    );
  });
});

describe('telemetry history limit', () => {
  it('keeps device history bounded to 20 rows', () => {
    expect(TELEMETRY_HISTORY_LIMIT).toBe(20);
  });
});
