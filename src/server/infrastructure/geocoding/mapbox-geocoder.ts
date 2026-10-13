import { z } from 'zod';

import { getServerEnv } from '@/server/config/env';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'mapbox-geocoder' });

const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/forward';
const GEOCODE_TIMEOUT_MS = 8_000;

/** Precise enough to be a home/charging address, not just a city. */
const ACCEPTED_FEATURE_TYPES = new Set(['address', 'secondary_address']);

const featureSchema = z
  .object({
    geometry: z.object({
      type: z.literal('Point'),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
    properties: z
      .object({
        mapbox_id: z.string().optional(),
        feature_type: z.string(),
        full_address: z.string().optional(),
        name: z.string(),
        place_formatted: z.string().optional(),
        context: z
          .object({
            place: z.object({ name: z.string() }).passthrough().optional(),
            region: z.object({ name: z.string() }).passthrough().optional(),
            postcode: z.object({ name: z.string() }).passthrough().optional(),
            country: z
              .object({ country_code: z.string() })
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const responseSchema = z
  .object({ features: z.array(z.unknown()) })
  .passthrough();

export type GeocodedAddress = {
  formattedAddress: string;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  placeId: string | null;
  /** True when requested with permanent=true (result may be stored). */
  permanent: boolean;
};

export type GeocodeResult =
  | { ok: true; address: GeocodedAddress }
  | { ok: false; reason: 'not_found' | 'not_precise' | 'unavailable' };

export type AddressGeocoder = {
  geocode(query: string): Promise<GeocodeResult>;
};

/** Pure: Mapbox v6 response → our shape. Exported for tests. */
export function parseMapboxGeocodeResponse(
  body: unknown,
  permanent: boolean,
): GeocodeResult {
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: 'unavailable' };
  }
  const first = parsed.data.features[0];
  if (first === undefined) {
    return { ok: false, reason: 'not_found' };
  }
  const feature = featureSchema.safeParse(first);
  if (!feature.success) {
    return { ok: false, reason: 'unavailable' };
  }
  const { geometry, properties } = feature.data;
  if (!ACCEPTED_FEATURE_TYPES.has(properties.feature_type)) {
    return { ok: false, reason: 'not_precise' };
  }
  const [longitude, latitude] = geometry.coordinates;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return { ok: false, reason: 'unavailable' };
  }
  const countryCode =
    properties.context?.country?.country_code.toUpperCase() ?? null;
  const formattedAddress =
    properties.full_address ??
    [properties.name, properties.place_formatted]
      .filter((part) => part !== undefined)
      .join(', ');
  return {
    ok: true,
    address: {
      formattedAddress: formattedAddress.slice(0, 300),
      city: properties.context?.place?.name ?? null,
      region: properties.context?.region?.name ?? null,
      postalCode: properties.context?.postcode?.name ?? null,
      countryCode:
        countryCode !== null && /^[A-Z]{2}$/.test(countryCode)
          ? countryCode
          : null,
      latitude,
      longitude,
      placeId: properties.mapbox_id ?? null,
      permanent,
    },
  };
}

/** Server-side Mapbox Geocoding v6. Null when no token is configured. */
export function createMapboxGeocoder(): AddressGeocoder | null {
  const env = getServerEnv();
  const token = env.MAPBOX_GEOCODING_TOKEN;
  if (token.length === 0) {
    return null;
  }
  const permanent = env.MAPBOX_PERMANENT_GEOCODING;

  return {
    async geocode(query) {
      const url = new URL(GEOCODE_URL);
      url.search = new URLSearchParams({
        q: query,
        limit: '1',
        types: 'address,secondary_address',
        permanent: permanent ? 'true' : 'false',
        access_token: token,
      }).toString();
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
        });
        if (!response.ok) {
          // Never log the URL: it carries the token and the address.
          log.warn('geocode.http_error', { status: response.status });
          return { ok: false, reason: 'unavailable' };
        }
        return parseMapboxGeocodeResponse(
          (await response.json()) as unknown,
          permanent,
        );
      } catch (error) {
        log.warn('geocode.request_failed', {
          errorName: error instanceof Error ? error.name : 'unknown',
        });
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
