import { createHmac } from 'node:crypto';

/**
 * Public pins are never shown at a device's real location. Each point is
 * moved by a stable offset between these distances, so the pin is always
 * within ~2 km of the real spot but never on top of it.
 */
export const PUBLIC_LOCATION_MIN_OFFSET_M = 500;
export const PUBLIC_LOCATION_MAX_OFFSET_M = 2_000;

const METERS_PER_DEGREE_LATITUDE = 111_320;

export type Coordinates = { latitude: number; longitude: number };

/**
 * Two uniform values in [0, 1) derived from a keyed hash. Keyed so nobody
 * without the secret can recompute (and subtract) the offset; stable so
 * repeated requests can't be averaged back to the real point.
 */
function seededUniforms(secret: string, key: string): [number, number] {
  const digest = createHmac('sha256', secret)
    .update(`public-location:v1:${key}`)
    .digest();
  return [digest.readUInt32BE(0) / 2 ** 32, digest.readUInt32BE(4) / 2 ** 32];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Moves `point` by a stable pseudo-random offset of 0.5–2 km. The radius is
 * area-uniform over the ring so the real point isn't more likely to be near
 * the pin's centre.
 *
 * @param key identifies what is being hidden (e.g. device + address id); a
 *   different key gives an unrelated offset.
 */
export function obfuscateCoordinates(
  point: Coordinates,
  input: { secret: string; key: string },
): Coordinates {
  const [u1, u2] = seededUniforms(input.secret, input.key);
  const bearing = 2 * Math.PI * u1;
  const min2 = PUBLIC_LOCATION_MIN_OFFSET_M ** 2;
  const max2 = PUBLIC_LOCATION_MAX_OFFSET_M ** 2;
  const distance = Math.sqrt(min2 + u2 * (max2 - min2));

  const dLat = (distance * Math.cos(bearing)) / METERS_PER_DEGREE_LATITUDE;
  // Near the poles a degree of longitude is tiny; clamp the cosine so the
  // offset stays finite (the latitude offset alone still moves the pin).
  const cosLat = Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.01);
  const dLng =
    (distance * Math.sin(bearing)) / (METERS_PER_DEGREE_LATITUDE * cosLat);

  const latitude = Math.min(90, Math.max(-90, point.latitude + dLat));
  let longitude = point.longitude + dLng;
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return { latitude: round6(latitude), longitude: round6(longitude) };
}

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
