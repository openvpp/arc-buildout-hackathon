import { z } from 'zod';

import { env } from '@/config/env';
import { ApiClient } from '@/lib/api/client';

const SUGGEST_URL = 'https://api.mapbox.com/search/geocode/v6/forward';

const suggestResponseSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        mapbox_id: z.string(),
        full_address: z.string().optional(),
        name: z.string(),
        place_formatted: z.string().optional(),
      }),
    }),
  ),
});

export type AddressSuggestion = { id: string; label: string };

export type DeviceAddressPayload = { query: string; unit?: string };

const ownerAddressSchema = z.object({
  formattedAddress: z.string(),
  unit: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().nullable(),
  updatedAt: z.string(),
});

/** True when the browser can offer address suggestions. */
export function canSuggestAddresses(): boolean {
  return env.NEXT_PUBLIC_MAPBOX_TOKEN.trim().length > 0;
}

/**
 * Address autocomplete via Mapbox (public token, suggestions only). The
 * picked text is sent to our server, which geocodes it itself — browser
 * coordinates are never trusted or sent.
 */
export async function suggestAddresses(
  query: string,
  signal: AbortSignal,
): Promise<AddressSuggestion[]> {
  if (!canSuggestAddresses() || query.trim().length < 3) {
    return [];
  }
  const url = new URL(SUGGEST_URL);
  url.search = new URLSearchParams({
    q: query.trim(),
    autocomplete: 'true',
    types: 'address',
    limit: '5',
    access_token: env.NEXT_PUBLIC_MAPBOX_TOKEN,
  }).toString();
  const response = await fetch(url, { signal });
  if (!response.ok) {
    return [];
  }
  const parsed = suggestResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    return [];
  }
  return parsed.data.features.map((feature) => ({
    id: feature.properties.mapbox_id,
    label:
      feature.properties.full_address ??
      [feature.properties.name, feature.properties.place_formatted]
        .filter((part) => part !== undefined)
        .join(', '),
  }));
}

export function createLocationApi(client: ApiClient = new ApiClient()) {
  return {
    async setDeviceAddress(deviceId: string, input: DeviceAddressPayload) {
      const result = await client.request(
        `/api/v1/dashboard/devices/${deviceId}/address`,
        { method: 'PUT', body: input, schema: ownerAddressSchema },
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
  };
}
