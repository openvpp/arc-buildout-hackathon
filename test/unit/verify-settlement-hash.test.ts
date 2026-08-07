import { describe, expect, it } from 'vitest';

import {
  buildCanonicalTelemetryDocument,
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
} from '@/server/domain/telemetry/canonical';

/**
 * Content-hash path used by dashboard Verify (Step-6 evidence).
 * Keeps canonical rebuild aligned with webhook ingestion.
 */
describe('settlement content-hash evidence', () => {
  it('recomputes the same content hash from a canonical document', () => {
    const document = buildCanonicalTelemetryDocument({
      deviceId: '11111111-1111-1111-1111-111111111111',
      source: 'enode',
      sourceObservedAt: new Date('2026-01-01T00:00:00.000Z'),
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      data: {
        stateOfChargePercent: 72,
        isCharging: true,
        isPluggedIn: true,
        rangeKilometers: 210,
        odometerKilometers: 12000,
        chargeRateKilowatts: 11,
        powerKilowatts: null,
        latitude: 37.77,
        longitude: -122.42,
      },
    });

    const first = hashCanonicalTelemetry(canonicalizeTelemetry(document));
    const second = hashCanonicalTelemetry(canonicalizeTelemetry(document));
    expect(second.contentHash).toBe(first.contentHash);
    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
