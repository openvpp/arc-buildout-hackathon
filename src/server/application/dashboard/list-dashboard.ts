import { desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import {
  agentVerificationResults,
  devices,
  principalWallets,
  telemetryRecords,
  wallets,
} from '@/server/infrastructure/db/schema';

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
