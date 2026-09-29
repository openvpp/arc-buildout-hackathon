import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';

const locationsSchema = z.object({
  locations: z.array(
    z.object({
      id: z.string(),
      displayName: z.string().nullable(),
      externalDeviceId: z.string(),
      vendor: z.string().nullable(),
      deviceType: z.string(),
      mintStatus: z.string(),
      latitude: z.number(),
      longitude: z.number(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export type DeviceLocation = z.infer<
  typeof locationsSchema
>['locations'][number];

export function createGlobeApi(client: ApiClient = new ApiClient()) {
  return {
    /**
     * Public — every device with a known location, not scoped to a wallet.
     * Follows cursors so a fleet larger than one page still renders. Caps
     * the walk so a broken cursor cannot loop forever.
     */
    async listLocations(signal?: AbortSignal): Promise<DeviceLocation[]> {
      const locations: DeviceLocation[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 25; page += 1) {
        const searchParams: Record<string, string> = { limit: '200' };
        if (cursor !== null) {
          searchParams.cursor = cursor;
        }
        const result = await client.request(
          '/api/v1/dashboard/devices/locations',
          {
            method: 'GET',
            searchParams,
            schema: locationsSchema,
            ...(signal !== undefined ? { signal } : {}),
          },
        );
        if (!result.ok) {
          throw result.error;
        }
        locations.push(...result.data.locations);
        if (result.data.nextCursor === null) {
          return locations;
        }
        cursor = result.data.nextCursor;
      }
      return locations;
    },
  };
}
