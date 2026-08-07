import { desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import {
  agentVerificationResults,
  devices,
  principalWallets,
  telemetryRecords,
  wallets,
} from '@/server/infrastructure/db/schema';

/** Recent telemetry metadata rows returned per device (bounded). */
export const TELEMETRY_HISTORY_LIMIT = 20;

export type TelemetryHistoryItem = {
  readonly id: string;
  readonly recordedAt: Date;
  readonly contentHash: string;
  readonly anchorStatus: string;
  readonly anchorTransactionHash: string | null;
};

export async function listWalletsForPrincipal(
  db: Database,
  principalId: string,
) {
  return db
    .select({
      id: wallets.id,
      address: wallets.address,
      label: wallets.label,
      chainId: wallets.chainId,
      status: wallets.status,
    })
    .from(principalWallets)
    .innerJoin(wallets, eq(wallets.id, principalWallets.walletId))
    .where(eq(principalWallets.principalId, principalId));
}

/**
 * Distinct wallets that appear in principal_wallets (any principal/role).
 * Used by the dashboard RSC until per-session Web3Auth cookie auth lands.
 */
export async function listBoundWallets(db: Database) {
  return db
    .selectDistinctOn([wallets.id], {
      id: wallets.id,
      address: wallets.address,
      label: wallets.label,
      chainId: wallets.chainId,
      status: wallets.status,
    })
    .from(principalWallets)
    .innerJoin(wallets, eq(wallets.id, principalWallets.walletId))
    .orderBy(wallets.id);
}

export async function listDevicesForWallet(db: Database, walletId: string) {
  return db.select().from(devices).where(eq(devices.walletId, walletId));
}

export async function getLatestTelemetryWithVerification(
  db: Database,
  deviceId: string,
) {
  const [latest] = await db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.deviceId, deviceId))
    .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
    .limit(1);

  if (latest === undefined) {
    return { latest: null, verification: null };
  }

  const [verification] = await db
    .select()
    .from(agentVerificationResults)
    .where(eq(agentVerificationResults.telemetryRecordId, latest.id))
    .orderBy(desc(agentVerificationResults.verifiedAt))
    .limit(1);

  return { latest, verification: verification ?? null };
}

async function buildSnapshotForWallets(
  db: Database,
  walletRows: Awaited<ReturnType<typeof listBoundWallets>>,
) {
  const result = [];

  for (const wallet of walletRows) {
    const deviceRows = await listDevicesForWallet(db, wallet.id);
    const devicesWithTelemetry = [];
    for (const device of deviceRows) {
      const { latest, verification } = await getLatestTelemetryWithVerification(
        db,
        device.id,
      );
      devicesWithTelemetry.push({
        device,
        latest,
        verification,
      });
    }
    result.push({ wallet, devices: devicesWithTelemetry });
  }

  return result;
}

export async function listDashboardSnapshot(db: Database, principalId: string) {
  const walletRows = await listWalletsForPrincipal(db, principalId);
  return buildSnapshotForWallets(db, walletRows);
}

export async function listDashboardSnapshotForBoundWallets(db: Database) {
  const walletRows = await listBoundWallets(db);
  return buildSnapshotForWallets(db, walletRows);
}

export async function listRecentTelemetryForDevice(
  db: Database,
  deviceId: string,
  limit: number = TELEMETRY_HISTORY_LIMIT,
): Promise<TelemetryHistoryItem[]> {
  const capped = Math.min(Math.max(limit, 1), TELEMETRY_HISTORY_LIMIT);
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
 * Device detail for dashboard viewers: only devices whose wallet appears in
 * principal_wallets. History is metadata-only (no telemetry payload).
 */
export async function getBoundDeviceDetail(db: Database, deviceId: string) {
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

  const { latest, verification } = await getLatestTelemetryWithVerification(
    db,
    device.id,
  );
  const history = await listRecentTelemetryForDevice(db, device.id);

  return {
    wallet,
    device,
    latest,
    verification,
    history,
  };
}
