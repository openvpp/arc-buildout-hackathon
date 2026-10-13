import { eq } from 'drizzle-orm';

import { displayMintStatus } from '@/server/application/dashboard/display-mint-status';
import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

export type PublicDevice = {
  id: string;
  displayName: string | null;
  vendor: string | null;
  model: string | null;
  deviceType: string;
  /** Globe status: this app's mint column, or a confirmed legacy Arc mint. */
  mintStatus: string;
};

/**
 * Device fields the public globe is allowed to open. No coordinates, address,
 * wallet, or provider vehicle id.
 */
export async function getPublicDevice(
  db: Database,
  deviceId: string,
): Promise<PublicDevice | null> {
  const [row] = await db
    .select({
      id: devices.id,
      displayName: devices.displayName,
      vendor: devices.vendor,
      model: devices.model,
      deviceType: devices.deviceType,
      mintStatus: devices.mintStatus,
      metadata: devices.metadata,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  return {
    id: row.id,
    displayName: row.displayName,
    vendor: row.vendor,
    model: row.model,
    deviceType: row.deviceType,
    mintStatus: displayMintStatus(row.mintStatus, row.metadata),
  };
}
