import { desc, eq, inArray } from 'drizzle-orm';

import {
  getLatestTelemetryWithVerification,
  listBoundWallets,
  listDevicesForWallet,
} from '@/server/application/dashboard/list-dashboard';
import { MAX_PAGE_SIZE } from '@/server/config/constants';
import type { Database } from '@/server/infrastructure/db/client';
import {
  principalWallets,
  principals,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';

/** Recent telemetry rows returned per device (bounded). */
export const ADMIN_TELEMETRY_HISTORY_LIMIT = 20;

export type AdminWalletBinding = {
  readonly principalId: string;
  readonly displayName: string;
  readonly type: string;
  readonly status: string;
  readonly role: string;
};

export type AdminTelemetryHistoryItem = {
  readonly id: string;
  readonly recordedAt: Date;
  readonly contentHash: string;
  readonly anchorStatus: string;
  readonly anchorTransactionHash: string | null;
};

async function listBindingsForWallets(
  db: Database,
  walletIds: readonly string[],
): Promise<Map<string, AdminWalletBinding[]>> {
  const byWallet = new Map<string, AdminWalletBinding[]>();
  if (walletIds.length === 0) {
    return byWallet;
  }

  const rows = await db
    .select({
      walletId: principalWallets.walletId,
      principalId: principals.id,
      displayName: principals.displayName,
      type: principals.type,
      status: principals.status,
      role: principalWallets.role,
    })
    .from(principalWallets)
    .innerJoin(principals, eq(principals.id, principalWallets.principalId))
    .where(inArray(principalWallets.walletId, [...walletIds]));

  for (const row of rows) {
    const list = byWallet.get(row.walletId) ?? [];
    list.push({
      principalId: row.principalId,
      displayName: row.displayName,
      type: row.type,
      status: row.status,
      role: row.role,
    });
    byWallet.set(row.walletId, list);
  }
  return byWallet;
}

export async function listRecentTelemetryForDevice(
  db: Database,
  deviceId: string,
  limit: number = ADMIN_TELEMETRY_HISTORY_LIMIT,
): Promise<AdminTelemetryHistoryItem[]> {
  const capped = Math.min(Math.max(limit, 1), ADMIN_TELEMETRY_HISTORY_LIMIT);
  return db
    .select({
      id: telemetryRecords.id,
      recordedAt: telemetryRecords.recordedAt,
      contentHash: telemetryRecords.contentHash,
      anchorStatus: telemetryRecords.anchorStatus,
      anchorTransactionHash: telemetryRecords.anchorTransactionHash,
    })
    .from(telemetryRecords)
    .where(eq(telemetryRecords.deviceId, deviceId))
    .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
    .limit(capped);
}

/**
 * Cross-tenant admin snapshot: bound wallets, principal bindings, devices,
 * latest telemetry + verification, and recent history (N=20) per device.
 * Wallet count is capped at MAX_PAGE_SIZE for hackathon safety.
 */
export async function listAdminSnapshotForBoundWallets(db: Database) {
  const walletRows = (await listBoundWallets(db)).slice(0, MAX_PAGE_SIZE);
  const bindingsByWallet = await listBindingsForWallets(
    db,
    walletRows.map((wallet) => wallet.id),
  );

  const result = [];

  for (const wallet of walletRows) {
    const deviceRows = await listDevicesForWallet(db, wallet.id);
    const devicesWithTelemetry = [];

    for (const device of deviceRows) {
      const { latest, verification } = await getLatestTelemetryWithVerification(
        db,
        device.id,
      );
      const history = await listRecentTelemetryForDevice(db, device.id);
      devicesWithTelemetry.push({
        device,
        latest,
        verification,
        history,
      });
    }

    result.push({
      wallet,
      bindings: bindingsByWallet.get(wallet.id) ?? [],
      devices: devicesWithTelemetry,
    });
  }

  return result;
}

export type AdminSnapshot = Awaited<
  ReturnType<typeof listAdminSnapshotForBoundWallets>
>;
