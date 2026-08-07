import { z } from 'zod';

import type { NormalizedTelemetryData } from '@/server/domain/telemetry/canonical';

const chargeStateSchema = z
  .object({
    batteryLevel: z.number().nullable().optional(),
    isCharging: z.boolean().nullable().optional(),
    isPluggedIn: z.boolean().nullable().optional(),
    range: z.number().nullable().optional(),
    chargeRate: z.number().nullable().optional(),
    power: z.number().nullable().optional(),
    lastUpdated: z.string().nullable().optional(),
  })
  .passthrough();

const odometerSchema = z
  .object({
    distance: z.number().nullable().optional(),
    lastUpdated: z.string().nullable().optional(),
  })
  .passthrough();

const locationSchema = z
  .object({
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    lastUpdated: z.string().nullable().optional(),
  })
  .passthrough();

/** Production Enode `user:vehicle:updated` event (nested `vehicle`). */
export const enodeProductionVehicleUpdatedSchema = z
  .object({
    event: z.string(),
    createdAt: z.string().optional(),
    version: z.string().optional(),
    user: z
      .object({
        id: z.string(),
      })
      .passthrough()
      .optional(),
    vehicle: z
      .object({
        id: z.string().min(1),
        chargeState: chargeStateSchema.optional(),
        odometer: odometerSchema.optional(),
        location: locationSchema.optional(),
      })
      .passthrough(),
    updatedFields: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Legacy flat / hackathon-shaped event kept for fixtures and older tests.
 * Prefer production schema for real Enode deliveries.
 */
export const enodeLegacyVehicleTelemetryEventSchema = z
  .object({
    id: z.string().optional(),
    eventId: z.string().optional(),
    type: z.string().optional(),
    event: z.string().optional(),
    createdAt: z.string().optional(),
    userId: z.string().optional(),
    vehicleId: z.string().min(1),
    data: z
      .object({
        chargeState: chargeStateSchema.optional(),
        odometer: odometerSchema.optional(),
        location: locationSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** @deprecated Use production + legacy schemas; kept for existing imports. */
export const enodeVehicleTelemetryEventSchema =
  enodeLegacyVehicleTelemetryEventSchema;

export type EnodeVehicleTelemetryEvent = z.infer<
  typeof enodeLegacyVehicleTelemetryEventSchema
>;

export type UnifiedEnodeVehicleEvent = {
  eventName: string;
  vehicleId: string;
  createdAt: string | null;
  sourceEventHint: string | null;
  chargeState: z.infer<typeof chargeStateSchema> | undefined;
  odometer: z.infer<typeof odometerSchema> | undefined;
  location: z.infer<typeof locationSchema> | undefined;
};

const VEHICLE_TELEMETRY_EVENTS = new Set([
  'user:vehicle:updated',
  'user:vehicle:discovered',
]);

/**
 * The Enode user id carried by a raw webhook event, from either the production
 * shape (`user.id`) or the legacy flat shape (`userId`). Used to attribute a
 * delivery to an environment for the tenancy guard.
 */
export function extractEnodeEventUserId(raw: unknown): string | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const user = record['user'];
  if (user !== null && typeof user === 'object') {
    const id = (user as Record<string, unknown>)['id'];
    if (typeof id === 'string' && id.trim().length > 0) {
      return id.trim();
    }
  }
  const userId = record['userId'];
  if (typeof userId === 'string' && userId.trim().length > 0) {
    return userId.trim();
  }
  return null;
}

/** True when every normalized telemetry field is null (e.g. a bare discovered event). */
export function isEmptyTelemetryData(data: NormalizedTelemetryData): boolean {
  return Object.values(data).every((value) => value === null);
}

export function extractEnodeWebhookEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload !== null && typeof payload === 'object') {
    return [payload];
  }
  return [];
}

export function summarizeEnodeWebhookEventTypes(events: unknown[]): string {
  const names = events
    .map((item) => {
      if (item === null || typeof item !== 'object') return 'unknown';
      const record = item as Record<string, unknown>;
      const eventName = record['event'];
      if (typeof eventName === 'string') return eventName;
      const typeName = record['type'];
      if (typeof typeName === 'string') return typeName;
      return 'unknown';
    })
    .slice(0, 5);
  if (names.length === 0) return 'empty';
  return names.join(',');
}

export function coerceEnodeVehicleEvent(
  raw: unknown,
): UnifiedEnodeVehicleEvent | null {
  const production = enodeProductionVehicleUpdatedSchema.safeParse(raw);
  if (production.success) {
    const eventName = production.data.event;
    if (!VEHICLE_TELEMETRY_EVENTS.has(eventName)) {
      return null;
    }
    return {
      eventName,
      vehicleId: production.data.vehicle.id,
      createdAt: production.data.createdAt ?? null,
      sourceEventHint: null,
      chargeState: production.data.vehicle.chargeState,
      odometer: production.data.vehicle.odometer,
      location: production.data.vehicle.location,
    };
  }

  const legacy = enodeLegacyVehicleTelemetryEventSchema.safeParse(raw);
  if (!legacy.success) {
    return null;
  }
  const eventName = legacy.data.event ?? legacy.data.type ?? 'legacy:vehicle';
  if (
    eventName !== 'legacy:vehicle' &&
    !VEHICLE_TELEMETRY_EVENTS.has(eventName)
  ) {
    return null;
  }
  return {
    eventName,
    vehicleId: legacy.data.vehicleId,
    createdAt: legacy.data.createdAt ?? null,
    sourceEventHint: legacy.data.eventId ?? legacy.data.id ?? null,
    chargeState: legacy.data.data?.chargeState,
    odometer: legacy.data.data?.odometer,
    location: legacy.data.data?.location,
  };
}

export function mapEnodeEventToNormalizedTelemetry(
  event: EnodeVehicleTelemetryEvent | UnifiedEnodeVehicleEvent,
): {
  externalDeviceId: string;
  sourceEventId: string | null;
  sourceObservedAt: Date | null;
  data: NormalizedTelemetryData;
} {
  if (isUnifiedEnodeVehicleEvent(event)) {
    return mapUnifiedEnodeVehicleEvent(event);
  }
  const coerced = coerceEnodeVehicleEvent(event);
  if (coerced === null) {
    throw new Error('Unsupported Enode vehicle event');
  }
  return mapUnifiedEnodeVehicleEvent(coerced);
}

function isUnifiedEnodeVehicleEvent(
  event: EnodeVehicleTelemetryEvent | UnifiedEnodeVehicleEvent,
): event is UnifiedEnodeVehicleEvent {
  return (
    'eventName' in event &&
    typeof event.eventName === 'string' &&
    !('data' in event)
  );
}

export function mapUnifiedEnodeVehicleEvent(event: UnifiedEnodeVehicleEvent): {
  externalDeviceId: string;
  sourceEventId: string | null;
  sourceObservedAt: Date | null;
  data: NormalizedTelemetryData;
} {
  const charge = event.chargeState;
  const odometer = event.odometer;
  const location = event.location;

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
    sourceEventId: event.sourceEventHint,
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
