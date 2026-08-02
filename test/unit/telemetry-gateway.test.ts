import { describe, expect, it, vi } from 'vitest';

import { createHttpTelemetryGateway } from '@/features/telemetry';
import type { ApiClient } from '@/lib/api/client';
import { toDeviceId, toWalletId } from '@/types/branded';

describe('createHttpTelemetryGateway', () => {
  it('maps a device read into telemetry_available', async () => {
    const walletId = toWalletId('11111111-1111-1111-1111-111111111111');
    const deviceId = toDeviceId('22222222-2222-2222-2222-222222222222');
    const request = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        device: { id: deviceId, walletId },
        latestTelemetry: {
          recordId: '33333333-3333-3333-3333-333333333333',
          recordedAt: '2026-06-01T12:00:00.000Z',
          contentHash: 'abc',
          anchorStatus: 'unanchored',
          anchorTransactionHash: null,
          data: {},
        },
        verification: null,
      },
      requestId: 'r1',
    });

    const gateway = createHttpTelemetryGateway({
      request,
    } as unknown as ApiClient);

    const result = await gateway.getLatestTelemetry(walletId, deviceId);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'telemetry_available',
        telemetry: expect.objectContaining({ deviceId }),
        provenance: expect.objectContaining({
          anchorTransactionRef: expect.stringContaining('pending:'),
        }),
      }),
    );
  });

  it('maps a null latest record into no_new_record', async () => {
    const walletId = toWalletId('11111111-1111-1111-1111-111111111111');
    const deviceId = toDeviceId('22222222-2222-2222-2222-222222222222');
    const request = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        device: { id: deviceId, walletId },
        latestTelemetry: null,
        verification: null,
      },
      requestId: 'r1',
    });

    const gateway = createHttpTelemetryGateway({
      request,
    } as unknown as ApiClient);

    const result = await gateway.getLatestTelemetry(walletId, deviceId);
    expect(result.status).toBe('no_new_record');
  });
});
