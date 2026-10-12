/**
 * Builders for the public, on-chain half of the time series. Each payload is
 * an explicit whitelist with a fixed key order and fixed rounding, so the
 * same session/day always serializes to the same bytes (and hash). Location,
 * wallet, user identity and provider ids are never included.
 *
 * Field names follow the reference implementation's existing on-chain
 * series (CHARGING_COMPLETED / TRIP_COMPLETED) so the data stays comparable.
 */

/** On-chain `eventType` ids — a contract-compatibility surface; don't renumber. */
export const DEVICE_EVENT_TYPES = {
  CHARGING_COMPLETED: 2,
  TRIP_COMPLETED: 12,
} as const;

/** Defensive cap; real payloads are ~400 bytes. */
export const MAX_DEVICE_EVENT_PAYLOAD_BYTES = 4_096;

const KM_PER_MILE = 1.609344;

/**
 * A day with less driving than this (0.1 mi, the reference's threshold) is
 * finalized off-chain but not published — it's parked, not a trip.
 */
export const MIN_PUBLISHED_DAILY_KM = 0.1 * KM_PER_MILE;

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function roundOrNull(value: number | null, decimals: number): number | null {
  return value === null ? null : round(value, decimals);
}

function serialize(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > MAX_DEVICE_EVENT_PAYLOAD_BYTES) {
    throw new Error('Device event payload exceeds the size cap');
  }
  return json;
}

export function kmToMiles(km: number): number {
  return km / KM_PER_MILE;
}

export type CompletedChargingSession = {
  /** Our devices.id — published as `vehicleId`. */
  deviceId: string;
  sessionId: string;
  startTime: Date;
  endTime: Date;
  energyDeliveredKwh: number;
  endBatteryLevel: number | null;
  energyMethod: 'estimated_from_battery_change';
  electricityPrice: number | null;
  totalCost: number | null;
  currency: string;
};

/** CHARGING_COMPLETED (eventType 2). */
export function buildChargingCompletedPayload(
  session: CompletedChargingSession,
): string {
  const energyDelivered = round(session.energyDeliveredKwh, 4);
  return serialize({
    vehicleId: session.deviceId,
    sessionId: session.sessionId,
    energyDelivered,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime.toISOString(),
    batteryLevel: roundOrNull(session.endBatteryLevel, 2),
    method: session.energyMethod,
    // No points system in this app; kept for schema parity with the
    // existing series, using the reference's rule (1 point per whole kWh).
    pointsAwarded: Math.floor(energyDelivered),
    electricityPrice: roundOrNull(session.electricityPrice, 4),
    totalCost: roundOrNull(session.totalCost, 4),
    currency: session.currency,
  });
}

export type FinalizedOdometerDay = {
  deviceId: string;
  /** `YYYY-MM-DD` (UTC). */
  dateUtc: string;
  startOdometerKm: number;
  endOdometerKm: number;
  startEstimated: boolean;
};

export function dailyTripIdFor(deviceId: string, dateUtc: string): string {
  return `daily-${deviceId}-${dateUtc}`;
}

/**
 * TRIP_COMPLETED (eventType 12): one per device per UTC day. Distances are
 * published in miles to match the existing series. Unlike the reference,
 * no speed/energy/efficiency/cost is published — those were derived from
 * assumptions, not measurements.
 */
export function buildDailyOdometerPayload(day: FinalizedOdometerDay): string {
  const start = new Date(`${day.dateUtc}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const startMiles = round(kmToMiles(day.startOdometerKm), 3);
  const endMiles = round(kmToMiles(day.endOdometerKm), 3);
  return serialize({
    vehicleId: day.deviceId,
    tripId: dailyTripIdFor(day.deviceId, day.dateUtc),
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    distanceTraveled: round(endMiles - startMiles, 3),
    duration: 1440,
    startOdometer: startMiles,
    endOdometer: endMiles,
    distanceUnit: 'mi',
    // True when the day's start is its own first reading (no reading the
    // day before), so overnight driving may be under-counted.
    startEstimated: day.startEstimated,
  });
}
