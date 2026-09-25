import { z } from 'zod';

import { ApiClient, ApiRequestError } from '@/lib/api/client';

const locationsSchema = z.object({
  locations: z.array(
    z.object({
      id: z.string(),
      displayName: z.string().nullable(),
      externalDeviceId: z.string(),
      vendor: z.string().nullable(),
      mintStatus: z.string(),
      latitude: z.number(),
      longitude: z.number(),
    }),
  ),
});

export type DeviceLocation = z.infer<
  typeof locationsSchema
>['locations'][number];

export function createGlobeApi(client: ApiClient = new ApiClient()) {
  return {
    /**
     * The globe is always visible, signed in or not — an anonymous visitor
     * simply sees no pins yet, not an error. Only a genuine failure (not
     * "you're not signed in") surfaces as an error state.
     */
    async listLocations(): Promise<DeviceLocation[]> {
      const result = await client.request(
        '/api/v1/dashboard/devices/locations',
        {
          method: 'GET',
          schema: locationsSchema,
        },
      );
      if (!result.ok) {
        if (
          result.error instanceof ApiRequestError &&
          result.error.code === 'UNAUTHENTICATED'
        ) {
          return [];
        }
        throw result.error;
      }
      return result.data.locations;
    },
  };
}
