import { describe, expect, it } from 'vitest';

import { mapEnodeWebhookEvent } from '@/server/infrastructure/enode/webhook-mapper';

function vehicleEvent(vehicle: Record<string, unknown>) {
  return {
    event: 'user:vehicle:updated',
    createdAt: '2026-10-12T10:30:00.000Z',
    vehicle: { id: 'veh-1', ...vehicle },
  };
}

describe('mapEnodeWebhookEvent telemetry', () => {
  it('maps chargeState and odometer', () => {
    const mapped = mapEnodeWebhookEvent(
      vehicleEvent({
        chargeState: {
          isCharging: true,
          isPluggedIn: true,
          batteryLevel: 63,
          batteryCapacity: 75,
          powerDeliveryState: 'PLUGGED_IN:CHARGING',
          lastUpdated: '2026-10-12T10:29:00.000Z',
        },
        odometer: {
          distance: 24512.7,
          lastUpdated: '2026-10-12T10:28:00.000Z',
        },
      }),
    );
    expect(mapped?.chargeState).toEqual({
      isCharging: true,
      isPluggedIn: true,
      batteryLevel: 63,
      batteryCapacityKwh: 75,
      powerDeliveryState: 'PLUGGED_IN:CHARGING',
      observedAt: new Date('2026-10-12T10:29:00.000Z'),
    });
    expect(mapped?.odometer).toEqual({
      km: 24512.7,
      observedAt: new Date('2026-10-12T10:28:00.000Z'),
    });
  });

  it('keeps unknown charge fields null instead of guessing', () => {
    const mapped = mapEnodeWebhookEvent(
      vehicleEvent({
        chargeState: {
          isCharging: null,
          batteryLevel: null,
          lastUpdated: null,
        },
      }),
    );
    expect(mapped?.chargeState).toMatchObject({
      isCharging: null,
      batteryLevel: null,
      batteryCapacityKwh: null,
      observedAt: null,
    });
  });

  it('drops implausible values', () => {
    const mapped = mapEnodeWebhookEvent(
      vehicleEvent({
        chargeState: {
          isCharging: false,
          batteryLevel: 140,
          batteryCapacity: 9000,
        },
        odometer: { distance: -5 },
      }),
    );
    expect(mapped?.chargeState).toMatchObject({
      batteryLevel: null,
      batteryCapacityKwh: null,
    });
    expect(mapped?.odometer).toBeNull();
  });

  it('keeps the event (and its location) when a telemetry block is malformed', () => {
    const mapped = mapEnodeWebhookEvent(
      vehicleEvent({
        location: { latitude: 10, longitude: 20 },
        chargeState: 'garbage',
        odometer: { distance: 'far' },
      }),
    );
    expect(mapped).not.toBeNull();
    expect(mapped?.latitude).toBe(10);
    expect(mapped?.chargeState).toBeNull();
    expect(mapped?.odometer).toBeNull();
  });

  it('returns null telemetry when the payload has none', () => {
    const mapped = mapEnodeWebhookEvent(vehicleEvent({}));
    expect(mapped?.chargeState).toBeNull();
    expect(mapped?.odometer).toBeNull();
  });
});
