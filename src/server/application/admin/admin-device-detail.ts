import { and, desc, eq, sql } from 'drizzle-orm';

import { displayMintStatus } from '@/server/application/dashboard/display-mint-status';
import { MIN_PUBLISHED_DAILY_KM } from '@/server/application/telemetry/device-event-payloads';
import { findDailySeriesGaps } from '@/server/application/verification/verify-device-event';
import {
  latestVerificationsFor,
  type StoredVerification,
} from '@/server/application/verification/verify-stored-event';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import {
  chainDeviceEvents,
  chainScanCursors,
  dailyOdometer,
  deviceAddresses,
  deviceEvents,
  devices,
  principalWallets,
  principals,
  wallets,
} from '@/server/infrastructure/db/schema';

/** Bounds: newest N records / chain logs per device page. */
const RECORD_LIMIT = 200;
const COMPLETENESS_DAYS_LIMIT = 3660;

type DeviceEventRow = typeof deviceEvents.$inferSelect;
type ChainLogRow = typeof chainDeviceEvents.$inferSelect;

export type ReconciledRecord =
  | {
      /** Our record and an indexed on-chain anchor for the same tx. */
      kind: 'matched';
      record: DeviceEventRow;
      chain: ChainLogRow;
      verification: StoredVerification | null;
    }
  | {
      /** Anchored per our receipt, not yet seen by the chain index. */
      kind: 'anchored_not_indexed';
      record: DeviceEventRow;
      verification: StoredVerification | null;
    }
  | {
      /** Ours, but no anchor (queued, sending, or failed). */
      kind: 'missing_on_chain';
      record: DeviceEventRow;
      verification: StoredVerification | null;
    }
  | {
      /** On-chain for this token, but this app has no record of it. */
      kind: 'on_chain_only';
      chain: ChainLogRow;
    };

export type AdminDeviceDetail = {
  device: typeof devices.$inferSelect;
  displayMintStatus: string;
  owner: { wallet: string; account: string | null };
  /** Admin sees the exact address and coordinates. */
  address: typeof deviceAddresses.$inferSelect | null;
  chain: {
    chainId: string;
    contractAddress: string | null;
    indexedThroughBlock: string | null;
  };
  reconciled: ReconciledRecord[];
  summary: {
    matched: number;
    anchoredNotIndexed: number;
    missingOnChain: number;
    onChainOnly: number;
  };
  completeness: { gaps: string[]; daysWithReadings: number };
};

export async function getAdminDeviceDetail(
  db: Database,
  deviceId: string,
): Promise<AdminDeviceDetail | null> {
  const env = getServerEnv();
  const [row] = await db
    .select({ device: devices, wallet: wallets.address })
    .from(devices)
    .innerJoin(wallets, eq(wallets.id, devices.walletId))
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const { device } = row;

  const [owner] = await db
    .select({ account: principals.displayName })
    .from(principalWallets)
    .innerJoin(principals, eq(principals.id, principalWallets.principalId))
    .where(
      and(
        eq(principalWallets.walletId, device.walletId),
        eq(principalWallets.role, 'owner'),
      ),
    )
    .limit(1);
  const [address] = await db
    .select()
    .from(deviceAddresses)
    .where(eq(deviceAddresses.deviceId, device.id))
    .limit(1);

  const records = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, device.id))
    .orderBy(desc(deviceEvents.occurredAt))
    .limit(RECORD_LIMIT);

  const chainId = BigInt(env.ARC_CHAIN_ID);
  const contract = env.DEVICE_NFT_CONTRACT_ADDRESS?.toLowerCase() ?? null;
  const chainLogs =
    device.nftTokenId === null || contract === null
      ? []
      : await db
          .select()
          .from(chainDeviceEvents)
          .where(
            and(
              eq(chainDeviceEvents.chainId, chainId),
              eq(chainDeviceEvents.contractAddress, contract),
              eq(chainDeviceEvents.tokenId, device.nftTokenId),
            ),
          )
          .orderBy(desc(chainDeviceEvents.blockNumber))
          .limit(RECORD_LIMIT);
  const [cursor] =
    contract === null
      ? []
      : await db
          .select({ last: chainScanCursors.lastScannedBlock })
          .from(chainScanCursors)
          .where(
            and(
              eq(chainScanCursors.chainId, chainId),
              eq(chainScanCursors.contractAddress, contract),
            ),
          )
          .limit(1);

  const verifications = await latestVerificationsFor(
    db,
    records.map((record) => record.id),
  );
  const chainByTx = new Map(
    chainLogs.map((entry) => [entry.transactionHash.toLowerCase(), entry]),
  );
  const matchedTx = new Set<string>();
  const reconciled: ReconciledRecord[] = records.map((record) => {
    const verification = verifications.get(record.id) ?? null;
    const tx = record.transactionHash?.toLowerCase();
    const chain = tx === undefined ? undefined : chainByTx.get(tx);
    if (chain !== undefined && tx !== undefined) {
      matchedTx.add(tx);
      return { kind: 'matched', record, chain, verification };
    }
    if (record.status === 'confirmed') {
      return { kind: 'anchored_not_indexed', record, verification };
    }
    return { kind: 'missing_on_chain', record, verification };
  });
  for (const chain of chainLogs) {
    if (!matchedTx.has(chain.transactionHash.toLowerCase())) {
      reconciled.push({ kind: 'on_chain_only', chain });
    }
  }

  const completeness = await dailyCompleteness(db, device.id);

  return {
    device,
    displayMintStatus: displayMintStatus(device.mintStatus, device.metadata),
    owner: { wallet: row.wallet, account: owner?.account ?? null },
    address: address ?? null,
    chain: {
      chainId: env.ARC_CHAIN_ID,
      contractAddress: env.DEVICE_NFT_CONTRACT_ADDRESS ?? null,
      indexedThroughBlock: cursor?.last.toString() ?? null,
    },
    reconciled,
    summary: {
      matched: reconciled.filter((r) => r.kind === 'matched').length,
      anchoredNotIndexed: reconciled.filter(
        (r) => r.kind === 'anchored_not_indexed',
      ).length,
      missingOnChain: reconciled.filter((r) => r.kind === 'missing_on_chain')
        .length,
      onChainOnly: reconciled.filter((r) => r.kind === 'on_chain_only').length,
    },
    completeness,
  };
}

/**
 * Days with raw odometer readings must be published, or explained: still
 * open, finalized under the publish threshold, or published but awaiting
 * its anchor. The rest are gaps (see findDailySeriesGaps).
 */
async function dailyCompleteness(
  db: Database,
  deviceId: string,
): Promise<{ gaps: string[]; daysWithReadings: number }> {
  const readingDays = await db.execute<{ day: string }>(sql`
    select distinct to_char((observed_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day
    from odometer_readings
    where device_id = ${deviceId}
    order by day desc
    limit ${COMPLETENESS_DAYS_LIMIT}
  `);
  const days = await db
    .select({
      dateUtc: dailyOdometer.dateUtc,
      status: dailyOdometer.status,
      distanceKm:
        sql<number>`(${dailyOdometer.endOdometerKm} - ${dailyOdometer.startOdometerKm})`.mapWith(
          Number,
        ),
      eventStatus: deviceEvents.status,
    })
    .from(dailyOdometer)
    .leftJoin(
      deviceEvents,
      and(
        eq(deviceEvents.sourceType, 'daily_odometer'),
        eq(deviceEvents.sourceId, dailyOdometer.id),
      ),
    )
    .where(eq(dailyOdometer.deviceId, deviceId))
    .orderBy(desc(dailyOdometer.dateUtc))
    .limit(COMPLETENESS_DAYS_LIMIT);

  const published = days
    .filter((day) => day.eventStatus === 'confirmed')
    .map((day) => day.dateUtc);
  const explained = days
    .filter(
      (day) =>
        day.status === 'open' ||
        (day.eventStatus === null && day.distanceKm < MIN_PUBLISHED_DAILY_KM) ||
        (day.eventStatus !== null &&
          day.eventStatus !== 'confirmed' &&
          day.eventStatus !== 'failed'),
    )
    .map((day) => day.dateUtc);
  const datesWithReadings = Array.from(readingDays, (entry) => entry.day);
  return {
    gaps: findDailySeriesGaps({
      datesWithReadings,
      publishedDates: published,
      explainedDates: explained,
    }),
    daysWithReadings: datesWithReadings.length,
  };
}
