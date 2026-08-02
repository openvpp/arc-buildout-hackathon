import { describe, expect, it } from 'vitest';

import {
  isPaymentRequiredResult,
  parseTelemetryRequestResult,
} from '@/features/telemetry';

describe('parseTelemetryRequestResult', () => {
  it('parses the payment_required variant', () => {
    const result = parseTelemetryRequestResult({
      status: 'payment_required',
      payment: {
        requestId: 'req-1',
        amount: '1000',
        currency: 'USDC',
        sellerAddress: '0xseller',
        chain: 'arc-testnet',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result.status).toBe('payment_required');
    expect(isPaymentRequiredResult(result)).toBe(true);
  });

  it('parses the no_new_record variant', () => {
    const result = parseTelemetryRequestResult({
      status: 'no_new_record',
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.status).toBe('no_new_record');
    expect(isPaymentRequiredResult(result)).toBe(false);
  });

  it('parses the telemetry_available variant with branded ids', () => {
    const result = parseTelemetryRequestResult({
      status: 'telemetry_available',
      telemetry: {
        id: 'rec-1',
        walletId: 'wallet-1',
        deviceId: 'device-1',
        recordedAt: '2026-01-01T00:00:00.000Z',
        contentHash: '0xhash',
      },
      provenance: {
        anchorTransactionRef: '0xanchor',
        contentHash: '0xhash',
        anchoredAt: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(result.status).toBe('telemetry_available');
  });

  it('rejects an unknown status', () => {
    expect(() => parseTelemetryRequestResult({ status: 'bogus' })).toThrow();
  });

  it('rejects a wrong currency', () => {
    expect(() =>
      parseTelemetryRequestResult({
        status: 'payment_required',
        payment: {
          requestId: 'req-1',
          amount: '1',
          currency: 'ETH',
          sellerAddress: '0x',
          chain: 'arc',
          expiresAt: 't',
        },
      }),
    ).toThrow();
  });
});
