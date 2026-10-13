import { describe, expect, it } from 'vitest';

import { deviceAddressInputSchema } from '@/server/application/location/device-address';
import {
  distanceMeters,
  obfuscateCoordinates,
  PUBLIC_LOCATION_MAX_OFFSET_M,
  PUBLIC_LOCATION_MIN_OFFSET_M,
} from '@/server/application/location/obfuscate-location';
import { parseMapboxGeocodeResponse } from '@/server/infrastructure/geocoding/mapbox-geocoder';

const SECRET = 'test-secret-at-least-16-chars';

describe('obfuscateCoordinates', () => {
  const places = [
    { latitude: 38.897684, longitude: -77.036574 },
    { latitude: 59.9139, longitude: 10.7522 },
    { latitude: -33.8688, longitude: 151.2093 },
    // Near the antimeridian and far north.
    { latitude: 64.8378, longitude: 179.999 },
    { latitude: 78.2232, longitude: 15.6267 },
  ];

  it('always lands 0.5–2 km from the real point', () => {
    for (const place of places) {
      for (let i = 0; i < 200; i += 1) {
        const moved = obfuscateCoordinates(place, {
          secret: SECRET,
          key: `device-${i}`,
        });
        const meters = distanceMeters(place, moved);
        // Allow ~1 m for 6-decimal rounding and the flat-earth step.
        expect(meters).toBeGreaterThanOrEqual(PUBLIC_LOCATION_MIN_OFFSET_M - 1);
        expect(meters).toBeLessThanOrEqual(PUBLIC_LOCATION_MAX_OFFSET_M + 1);
        expect(Math.abs(moved.longitude)).toBeLessThanOrEqual(180);
      }
    }
  });

  it('is stable for the same device, so averaging reveals nothing', () => {
    const place = places[0]!;
    const a = obfuscateCoordinates(place, { secret: SECRET, key: 'dev-1' });
    const b = obfuscateCoordinates(place, { secret: SECRET, key: 'dev-1' });
    expect(a).toEqual(b);
  });

  it('differs per device and per secret', () => {
    const place = places[0]!;
    const base = obfuscateCoordinates(place, { secret: SECRET, key: 'dev-1' });
    expect(
      obfuscateCoordinates(place, { secret: SECRET, key: 'dev-2' }),
    ).not.toEqual(base);
    expect(
      obfuscateCoordinates(place, {
        secret: 'another-secret-value',
        key: 'dev-1',
      }),
    ).not.toEqual(base);
  });

  it('spreads pins in every direction', () => {
    const place = places[1]!;
    const quadrants = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const moved = obfuscateCoordinates(place, {
        secret: SECRET,
        key: `q-${i}`,
      });
      quadrants.add(
        `${moved.latitude > place.latitude ? 'N' : 'S'}${moved.longitude > place.longitude ? 'E' : 'W'}`,
      );
    }
    expect(quadrants.size).toBe(4);
  });
});

/** Trimmed from a real Mapbox Geocoding v6 response. */
const REAL_RESPONSE = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-77.036574, 38.897684] },
      properties: {
        mapbox_id:
          'dXJuOm1ieGFkcjoxMDg4MTIxNi1mZTUwLTQyM2QtOWNjYS00ODQxYjNjMmFkNTA',
        feature_type: 'address',
        full_address:
          '1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500, United States',
        name: '1600 Pennsylvania Avenue Northwest',
        place_formatted:
          'Washington, District of Columbia 20500, United States',
        context: {
          postcode: { mapbox_id: 'x', name: '20500' },
          place: { mapbox_id: 'x', name: 'Washington' },
          region: {
            mapbox_id: 'x',
            name: 'District of Columbia',
            region_code: 'DC',
          },
          country: {
            mapbox_id: 'x',
            name: 'United States',
            country_code: 'us',
          },
        },
      },
    },
  ],
  attribution: 'NOTICE',
};

describe('parseMapboxGeocodeResponse', () => {
  it('maps a real address result', () => {
    expect(parseMapboxGeocodeResponse(REAL_RESPONSE, true)).toEqual({
      ok: true,
      address: {
        formattedAddress:
          '1600 Pennsylvania Avenue Northwest, Washington, District of Columbia 20500, United States',
        city: 'Washington',
        region: 'District of Columbia',
        postalCode: '20500',
        countryCode: 'US',
        latitude: 38.897684,
        longitude: -77.036574,
        placeId:
          'dXJuOm1ieGFkcjoxMDg4MTIxNi1mZTUwLTQyM2QtOWNjYS00ODQxYjNjMmFkNTA',
        permanent: true,
      },
    });
  });

  it('rejects a city-level match as not precise', () => {
    const cityOnly = structuredClone(REAL_RESPONSE);
    cityOnly.features[0]!.properties.feature_type = 'place';
    expect(parseMapboxGeocodeResponse(cityOnly, false)).toEqual({
      ok: false,
      reason: 'not_precise',
    });
  });

  it('handles no match and malformed bodies', () => {
    expect(parseMapboxGeocodeResponse({ features: [] }, false)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(parseMapboxGeocodeResponse('nope', false)).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('deviceAddressInputSchema', () => {
  it('never accepts coordinates from the browser', () => {
    expect(
      deviceAddressInputSchema.safeParse({
        query: '1 Main Street, Springfield',
        latitude: 1,
        longitude: 2,
      }).success,
    ).toBe(false);
  });

  it('requires a real-looking address', () => {
    expect(deviceAddressInputSchema.safeParse({ query: 'x' }).success).toBe(
      false,
    );
    expect(
      deviceAddressInputSchema.safeParse({
        query: '1 Main Street, Springfield',
        unit: 'Apt 4',
      }).success,
    ).toBe(true);
  });
});
