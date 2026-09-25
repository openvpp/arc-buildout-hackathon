import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';

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
    async listLocations(): Promise<DeviceLocation[]> {
      const result = await client.request(
        '/api/v1/dashboard/devices/locations',
        {
          method: 'GET',
          schema: locationsSchema,
        },
      );
      if (!result.ok) {
        throw result.error;
      }
      return result.data.locations;
    },
  };
}
