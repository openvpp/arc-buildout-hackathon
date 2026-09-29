import { z } from 'zod';

const locationSchema = z
  .object({
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
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
      })
      .passthrough(),
  })
  .passthrough();

export type NormalizedEnodeVehicleEvent = {
  eventName: string;
  externalUserId: string | null;
  vehicleId: string;
  latitude: number | null;
  longitude: number | null;
  /** When Enode says the event happened. Null if the payload has no usable time. */
  occurredAt: Date | null;
};

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

function occurredAtFrom(value: string | undefined): Date | null {
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
  };
}
