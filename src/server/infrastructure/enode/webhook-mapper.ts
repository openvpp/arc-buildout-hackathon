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
};

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
  return {
    eventName: parsed.data.event,
    externalUserId: parsed.data.user?.id ?? null,
    vehicleId: parsed.data.vehicle.id,
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
  };
}
