import { eq } from 'drizzle-orm';

import {
  getLatestTelemetryWithVerification,
  listBoundWallets,
  listOwnerTelemetryHistoryForDevice,
} from '@/server/application/dashboard/list-dashboard';
import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

import {
  listBindingsForWallets,
  type AdminWalletBinding,
} from './list-admin-snapshot';

/**
 * Cross-tenant admin device detail: full stored telemetry payloads plus
 * settlement/verification fields and principal bindings for the owning wallet.
 */
export async function getAdminDeviceDetail(db: Database, deviceId: string) {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (device === undefined) {
    return null;
  }

  const walletRows = await listBoundWallets(db);
  const wallet = walletRows.find((row) => row.id === device.walletId);
  if (wallet === undefined) {
    return null;
  }

  const bindingsByWallet = await listBindingsForWallets(db, [wallet.id]);
  const { latest, verification } = await getLatestTelemetryWithVerification(
    db,
    device.id,
  );
  const history = await listOwnerTelemetryHistoryForDevice(db, device.id);

  return {
    wallet,
    bindings: bindingsByWallet.get(wallet.id) ?? ([] as AdminWalletBinding[]),
    device,
    latest,
    verification,
    history,
  };
}

export type AdminDeviceDetail = NonNullable<
  Awaited<ReturnType<typeof getAdminDeviceDetail>>
>;
