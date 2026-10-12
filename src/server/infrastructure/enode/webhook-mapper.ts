import { z } from 'zod';

const locationSchema = z
  .object({
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  })
  .passthrough();

// Enode reports these as nullable when the OEM doesn't expose them.
const chargeStateSchema = z
  .object({
    isCharging: z.boolean().nullable().optional(),
    isPluggedIn: z.boolean().nullable().optional(),
    batteryLevel: z.number().nullable().optional(),
    batteryCapacity: z.number().nullable().optional(),
    powerDeliveryState: z.string().nullable().optional(),
    lastUpdated: z.string().nullable().optional(),
  })
  .passthrough();

// `distance` is the full odometer reading in kilometers.
const odometerSchema = z
  .object({
    distance: z.number().nullable().optional(),
    lastUpdated: z.string().nullable().optional(),
  })
  .passthrough();

/** Enode `user:vehicle:updated` / `user:vehicle:discovered` webhook event. */
const enodeVehicleEventSchema = z
  .object({
    event: z.string(),
    createdAt: z.string().optional(),
    user: z.object({ id: z.string() }).passthrough().optional(),
    vehicle: z
      .object({
        id: z.string().min(1),
        location: locationSchema.optional(),
        // Malformed telemetry blocks are dropped (`.catch`) rather than
        // rejecting the whole event, so location still updates.
        chargeState: chargeStateSchema.nullable().optional().catch(null),
        odometer: odometerSchema.nullable().optional().catch(null),
      })
      .passthrough(),
  })
  .passthrough();

export type NormalizedChargeState = {
  /** Null when the OEM doesn't report charging status — never guessed. */
  isCharging: boolean | null;
  isPluggedIn: boolean | null;
  /** State of charge, 0–100. */
  batteryLevel: number | null;
  batteryCapacityKwh: number | null;
  powerDeliveryState: string | null;
  /** When the OEM last refreshed charge state. */
  observedAt: Date | null;
};

export type NormalizedOdometer = {
  km: number;
  observedAt: Date | null;
};

export type NormalizedEnodeVehicleEvent = {
  eventName: string;
  externalUserId: string | null;
  vehicleId: string;
  latitude: number | null;
  longitude: number | null;
  /** When Enode says the event happened. Null if the payload has no usable time. */
  occurredAt: Date | null;
  chargeState: NormalizedChargeState | null;
  odometer: NormalizedOdometer | null;
};

// Largest plausible EV pack; anything above is a unit/parse error.
const MAX_BATTERY_CAPACITY_KWH = 250;
// Above this an odometer value (km) is not a real vehicle reading.
const MAX_ODOMETER_KM = 5_000_000;

function finiteCoordinate(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/** Rejects values that cannot be a WGS84 point, including NaN. */
export function plausibleCoordinates(
  latitude: number | null,
  longitude: number | null,
): { latitude: number; longitude: number } | null {
  if (
    latitude === null ||
    longitude === null ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function inRange(
  value: number | null | undefined,
  min: number,
  max: number,
): number | null {
  const finite = finiteCoordinate(value);
  return finite !== null && finite >= min && finite <= max ? finite : null;
}

function occurredAtFrom(value: string | null | undefined): Date | null {
  if (value === null) {
    return null;
  }
  if (value === undefined || value.length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const VEHICLE_EVENTS = new Set([
  'user:vehicle:updated',
  'user:vehicle:discovered',
]);

export function extractEnodeWebhookEvents(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  return payload !== null && typeof payload === 'object' ? [payload] : [];
}

function normalizeChargeState(
  raw: z.infer<typeof chargeStateSchema> | null | undefined,
): NormalizedChargeState | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const capacity = inRange(raw.batteryCapacity, 0, MAX_BATTERY_CAPACITY_KWH);
  return {
    isCharging: raw.isCharging ?? null,
    isPluggedIn: raw.isPluggedIn ?? null,
    batteryLevel: inRange(raw.batteryLevel, 0, 100),
    batteryCapacityKwh: capacity !== null && capacity > 0 ? capacity : null,
    powerDeliveryState: raw.powerDeliveryState ?? null,
    observedAt: occurredAtFrom(raw.lastUpdated),
  };
}

function normalizeOdometer(
  raw: z.infer<typeof odometerSchema> | null | undefined,
): NormalizedOdometer | null {
  const km = inRange(raw?.distance, 0, MAX_ODOMETER_KM);
  if (raw === null || raw === undefined || km === null) {
    return null;
  }
  return { km, observedAt: occurredAtFrom(raw.lastUpdated) };
}

export function mapEnodeWebhookEvent(
  raw: unknown,
): NormalizedEnodeVehicleEvent | null {
  const parsed = enodeVehicleEventSchema.safeParse(raw);
  if (!parsed.success || !VEHICLE_EVENTS.has(parsed.data.event)) {
    return null;
  }
  const location = parsed.data.vehicle.location;
  const coordinates = plausibleCoordinates(
    finiteCoordinate(location?.latitude),
    finiteCoordinate(location?.longitude),
  );
  return {
    eventName: parsed.data.event,
    externalUserId: parsed.data.user?.id ?? null,
    vehicleId: parsed.data.vehicle.id,
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    occurredAt: occurredAtFrom(parsed.data.createdAt),
    chargeState: normalizeChargeState(parsed.data.vehicle.chargeState),
    odometer: normalizeOdometer(parsed.data.vehicle.odometer),
  };
}
