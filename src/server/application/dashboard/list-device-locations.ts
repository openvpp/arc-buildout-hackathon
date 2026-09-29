import { and, desc, isNotNull } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

export type DeviceLocation = {
  id: string;
  displayName: string | null;
  externalDeviceId: string;
  vendor: string | null;
  deviceType: string;
  mintStatus: string;
  latitude: number;
  longitude: number;
};

/**
 * Every device with a known location, across every wallet — the globe is a
 * public view of the whole connected fleet, not scoped to who (if anyone)
 * is signed in. Devices without coordinates are simply omitted — no
 * fallback pin. Paginated (default page size 100) to keep this a bounded
 * query as the fleet grows.
 */
export async function listAllDeviceLocations(
  db: Database,
  input?: { limit?: number },
): Promise<DeviceLocation[]> {
  const limit = Math.min(input?.limit ?? 100, 200);
  const rows = await db
    .select({
      id: devices.id,
      displayName: devices.displayName,
      externalDeviceId: devices.externalDeviceId,
      vendor: devices.vendor,
      deviceType: devices.deviceType,
      mintStatus: devices.mintStatus,
      lastLatitude: devices.lastLatitude,
      lastLongitude: devices.lastLongitude,
    })
    .from(devices)
    .where(
      and(isNotNull(devices.lastLatitude), isNotNull(devices.lastLongitude)),
    )
    .orderBy(desc(devices.lastLocationAt))
    .limit(limit);

  return rows
    .filter((row) => row.lastLatitude !== null && row.lastLongitude !== null)
    .map((row) => ({
      id: row.id,
      displayName: row.displayName,
      externalDeviceId: row.externalDeviceId,
      vendor: row.vendor,
      deviceType: row.deviceType,
      mintStatus: row.mintStatus,
      latitude: Number(row.lastLatitude),
      longitude: Number(row.lastLongitude),
    }));
}
