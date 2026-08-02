import { describe, expect, it } from 'vitest';

import {
  enodeVehicleTelemetryEventSchema,
  mapEnodeEventToNormalizedTelemetry,
} from '@/server/infrastructure/enode/webhook-mapper';

describe('enode webhook mapper', () => {
  it('maps charge state fields without coercing missing to zero', () => {
    const parsed = enodeVehicleTelemetryEventSchema.parse({
      vehicleId: 'veh-1',
      eventId: 'evt-1',
      type: 'user:vehicle:updated',
      data: {
        chargeState: {
          batteryLevel: 55.5,
          isCharging: false,
          lastUpdated: '2026-02-01T12:00:00.000Z',
        },
      },
    });

    const mapped = mapEnodeEventToNormalizedTelemetry(parsed);
    expect(mapped.externalDeviceId).toBe('veh-1');
    expect(mapped.data.stateOfChargePercent).toBe(55.5);
    expect(mapped.data.isCharging).toBe(false);
    expect(mapped.data.odometerKilometers).toBeNull();
    expect(mapped.data.rangeKilometers).toBeNull();
  });

  it('accepts unknown additive fields', () => {
    const parsed = enodeVehicleTelemetryEventSchema.parse({
      vehicleId: 'veh-2',
      data: {
        chargeState: { batteryLevel: 10, weirdFutureField: true },
        brandNewSection: { ok: true },
      },
    });
    expect(parsed.vehicleId).toBe('veh-2');
  });
});
