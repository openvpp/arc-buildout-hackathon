import { z } from 'zod';

import type { NormalizedTelemetryData } from '@/server/domain/telemetry/canonical';

/**
 * Supported Enode-like vehicle telemetry event shapes.
 * Unknown additive fields are ignored; required mappings stay stable.
 */
export const enodeVehicleTelemetryEventSchema = z
  .object({
    id: z.string().optional(),
    eventId: z.string().optional(),
    type: z.string().optional(),
    createdAt: z.string().optional(),
    userId: z.string().optional(),
    vehicleId: z.string().min(1),
    data: z
      .object({
        chargeState: z
          .object({
            batteryLevel: z.number().nullable().optional(),
            isCharging: z.boolean().nullable().optional(),
            isPluggedIn: z.boolean().nullable().optional(),
            range: z.number().nullable().optional(),
            chargeRate: z.number().nullable().optional(),
            power: z.number().nullable().optional(),
            lastUpdated: z.string().nullable().optional(),
          })
          .passthrough()
          .optional(),
        odometer: z
          .object({
            distance: z.number().nullable().optional(),
            lastUpdated: z.string().nullable().optional(),
          })
          .passthrough()
          .optional(),
        location: z
          .object({
            latitude: z.number().nullable().optional(),
            longitude: z.number().nullable().optional(),
            lastUpdated: z.string().nullable().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type EnodeVehicleTelemetryEvent = z.infer<
  typeof enodeVehicleTelemetryEventSchema
>;

export function mapEnodeEventToNormalizedTelemetry(
  event: EnodeVehicleTelemetryEvent,
): {
  externalDeviceId: string;
  sourceEventId: string | null;
  sourceObservedAt: Date | null;
  data: NormalizedTelemetryData;
} {
  const charge = event.data?.chargeState;
  const odometer = event.data?.odometer;
  const location = event.data?.location;

  const observedCandidates = [
    charge?.lastUpdated,
    odometer?.lastUpdated,
    location?.lastUpdated,
    event.createdAt,
  ].filter((value): value is string => typeof value === 'string');

  const sourceObservedAt =
    observedCandidates.length > 0
      ? new Date(observedCandidates[0] ?? '')
      : null;

  return {
    externalDeviceId: event.vehicleId,
    sourceEventId: event.eventId ?? event.id ?? null,
    sourceObservedAt:
      sourceObservedAt !== null && !Number.isNaN(sourceObservedAt.getTime())
        ? sourceObservedAt
        : null,
    data: {
      stateOfChargePercent:
        charge?.batteryLevel === undefined ? null : charge.batteryLevel,
      isCharging: charge?.isCharging === undefined ? null : charge.isCharging,
      isPluggedIn:
        charge?.isPluggedIn === undefined ? null : charge.isPluggedIn,
      rangeKilometers: charge?.range === undefined ? null : charge.range,
      odometerKilometers:
        odometer?.distance === undefined ? null : odometer.distance,
      chargeRateKilowatts:
        charge?.chargeRate === undefined ? null : charge.chargeRate,
      powerKilowatts: charge?.power === undefined ? null : charge.power,
      latitude: location?.latitude === undefined ? null : location.latitude,
      longitude: location?.longitude === undefined ? null : location.longitude,
    },
  };
}
