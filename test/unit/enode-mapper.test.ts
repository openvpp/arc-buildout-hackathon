import { describe, expect, it } from 'vitest';

import {
  coerceEnodeVehicleEvent,
  extractEnodeWebhookEvents,
  mapEnodeEventToNormalizedTelemetry,
  mapUnifiedEnodeVehicleEvent,
  enodeLegacyVehicleTelemetryEventSchema,
  summarizeEnodeWebhookEventTypes,
} from '@/server/infrastructure/enode/webhook-mapper';

describe('enode webhook mapper', () => {
  it('maps legacy charge state fields without coercing missing to zero', () => {
    const parsed = enodeLegacyVehicleTelemetryEventSchema.parse({
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

  it('maps production nested vehicle event', () => {
    const coerced = coerceEnodeVehicleEvent({
      event: 'user:vehicle:updated',
      createdAt: '2020-04-07T17:04:26Z',
      version: '2024-10-01',
      user: { id: 'user-1' },
      vehicle: {
        id: 'veh-prod-1',
        userId: 'user-1',
        vendor: 'TESLA',
        chargeState: {
          batteryLevel: 72,
          isCharging: true,
          isPluggedIn: true,
          range: 280,
          chargeRate: 11,
          lastUpdated: '2020-04-07T17:04:00Z',
        },
        odometer: { distance: 12_000, lastUpdated: '2020-04-07T17:00:00Z' },
        location: {
          latitude: 37.77,
          longitude: -122.42,
          lastUpdated: '2020-04-07T17:04:00Z',
        },
      },
      updatedFields: ['chargeState'],
    });

    expect(coerced).not.toBeNull();
    if (coerced === null) return;

    const mapped = mapUnifiedEnodeVehicleEvent(coerced);
    expect(mapped.externalDeviceId).toBe('veh-prod-1');
    expect(mapped.data.stateOfChargePercent).toBe(72);
    expect(mapped.data.isCharging).toBe(true);
    expect(mapped.data.odometerKilometers).toBe(12_000);
    expect(mapped.data.latitude).toBe(37.77);
  });

  it('extracts array deliveries and summarizes event types', () => {
    const events = extractEnodeWebhookEvents([
      { event: 'user:vehicle:updated' },
      { event: 'enode:webhook:test' },
    ]);
    expect(events).toHaveLength(2);
    expect(summarizeEnodeWebhookEventTypes(events)).toBe(
      'user:vehicle:updated,enode:webhook:test',
    );
  });

  it('ignores non-vehicle production events', () => {
    expect(
      coerceEnodeVehicleEvent({
        event: 'enode:webhook:test',
        createdAt: '2020-04-07T17:04:26Z',
        vehicle: { id: 'veh-x' },
      }),
    ).toBeNull();
  });

  it('accepts unknown additive fields on legacy shape', () => {
    const parsed = enodeLegacyVehicleTelemetryEventSchema.parse({
      vehicleId: 'veh-2',
      data: {
        chargeState: { batteryLevel: 10, weirdFutureField: true },
        brandNewSection: { ok: true },
      },
    });
    expect(parsed.vehicleId).toBe('veh-2');
  });
});
