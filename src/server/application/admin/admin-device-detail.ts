import { and, desc, eq, inArray, sql } from 'drizzle-orm';

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
export const RECONCILE_WINDOW = 200;
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
      /**
       * Our record's transaction is on-chain for this token, but no log in
       * it carries our bytes and event type: a different anchor than the
       * one we recorded.
       */
      kind: 'conflict';
      record: DeviceEventRow;
      chainLogs: ChainLogRow[];
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
    conflict: number;
    onChainOnly: number;
  };
  /** True when older records or chain logs exist beyond the window shown. */
  truncated: boolean;
  completeness: { gaps: string[]; daysWithReadings: number };
};

export async function getAdminDeviceDetail(
  db: Database,
  deviceId: string,
  window: number = RECONCILE_WINDOW,
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

  const newestRecords = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, device.id))
    .orderBy(desc(deviceEvents.occurredAt), desc(deviceEvents.id))
    .limit(window);

  const chainId = BigInt(env.ARC_CHAIN_ID);
  const contract = env.DEVICE_NFT_CONTRACT_ADDRESS?.toLowerCase() ?? null;
  const tokenId = device.nftTokenId;
  const tokenLogs =
    tokenId === null || tokenId === '' || contract === null
      ? null
      : and(
          eq(chainDeviceEvents.chainId, chainId),
          eq(chainDeviceEvents.contractAddress, contract),
          eq(chainDeviceEvents.tokenId, tokenId),
        );
  const newestLogs =
    tokenLogs === null
      ? []
      : await db
          .select()
          .from(chainDeviceEvents)
          .where(tokenLogs)
          .orderBy(
            desc(chainDeviceEvents.blockNumber),
            desc(chainDeviceEvents.logIndex),
          )
          .limit(window);

  // The two windows are ordered differently (activity time vs. block), so
  // each side also loads the other side's counterparts by transaction —
  // otherwise an anchor whose record falls outside the record window would
  // look like another writer's.
  const txOf = (hash: string | null) => hash?.toLowerCase() ?? null;
  const recordTxs = new Set(
    newestRecords.flatMap((record) => txOf(record.transactionHash) ?? []),
  );
  const logTxs = new Set(newestLogs.map((log) => txOf(log.transactionHash)));
  const missingRecordTxs = [...logTxs].filter(
    (tx): tx is string => tx !== null && !recordTxs.has(tx),
  );
  const missingLogTxs = [...recordTxs].filter((tx) => !logTxs.has(tx));
  const extraRecords =
    missingRecordTxs.length === 0
      ? []
      : await db
          .select()
          .from(deviceEvents)
          .where(
            and(
              eq(deviceEvents.deviceId, device.id),
              inArray(
                sql<string>`lower(${deviceEvents.transactionHash})`,
                missingRecordTxs,
              ),
            ),
          );
  const extraLogs =
    tokenLogs === null || missingLogTxs.length === 0
      ? []
      : await db
          .select()
          .from(chainDeviceEvents)
          .where(
            and(
              tokenLogs,
              inArray(chainDeviceEvents.transactionHash, missingLogTxs),
            ),
          );
  const records = [...newestRecords, ...extraRecords];
  const chainLogs = [...newestLogs, ...extraLogs];

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
  const logsByTx = new Map<string, ChainLogRow[]>();
  for (const log of chainLogs) {
    const tx = log.transactionHash.toLowerCase();
    logsByTx.set(tx, [...(logsByTx.get(tx) ?? []), log]);
  }
  const accounted = new Set<string>();
  const reconciled: ReconciledRecord[] = records.map((record) => {
    const verification = verifications.get(record.id) ?? null;
    const tx = txOf(record.transactionHash);
    const sameTx = tx === null ? [] : (logsByTx.get(tx) ?? []);
    // A transaction can carry several DeviceEvents: ours is the one with
    // our exact bytes and event type.
    const exact = sameTx.find(
      (log) =>
        !accounted.has(log.id) &&
        log.dataHash.toLowerCase() === record.payloadHash.toLowerCase() &&
        log.eventType === record.eventType,
    );
    if (exact !== undefined) {
      accounted.add(exact.id);
      return { kind: 'matched', record, chain: exact, verification };
    }
    if (sameTx.length > 0) {
      const others = sameTx.filter((log) => !accounted.has(log.id));
      if (others.length > 0) {
        for (const log of others) accounted.add(log.id);
        return {
          kind: 'conflict',
          record,
          chainLogs: others,
          verification,
        };
      }
    }
    if (record.status === 'confirmed') {
      return { kind: 'anchored_not_indexed', record, verification };
    }
    return { kind: 'missing_on_chain', record, verification };
  });
  for (const chain of chainLogs) {
    if (!accounted.has(chain.id)) {
      reconciled.push({ kind: 'on_chain_only', chain });
    }
  }
  const countOf = (kind: ReconciledRecord['kind']) =>
    reconciled.filter((entry) => entry.kind === kind).length;

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
      matched: countOf('matched'),
      anchoredNotIndexed: countOf('anchored_not_indexed'),
      missingOnChain: countOf('missing_on_chain'),
      conflict: countOf('conflict'),
      onChainOnly: countOf('on_chain_only'),
    },
    truncated: newestRecords.length === window || newestLogs.length === window,
    completeness,
  };
}

/**
 * Days with raw odometer readings must be published, or explained: still
 * open, finalized under the publish threshold, published but awaiting its
 * anchor, or a day whose readings all arrived after a later day had already
 * been rolled up (kept raw on purpose, never re-published). The rest are
 * gaps (see findDailySeriesGaps).
 */
async function dailyCompleteness(
  db: Database,
  deviceId: string,
): Promise<{ gaps: string[]; daysWithReadings: number }> {
  const readingDays = await db.execute<{
    day: string;
    first_stored_at: string;
  }>(sql`
    select to_char((observed_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
      min(created_at)::text as first_stored_at
    from odometer_readings
    where device_id = ${deviceId}
    group by 1
    order by day desc
    limit ${COMPLETENESS_DAYS_LIMIT}
  `);
  const days = await db
    .select({
      dateUtc: dailyOdometer.dateUtc,
      status: dailyOdometer.status,
      createdAt: dailyOdometer.createdAt,
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
  const withRow = new Set(days.map((day) => day.dateUtc));
  const lateOnly = Array.from(readingDays)
    .filter(
      (reading) =>
        !withRow.has(reading.day) &&
        days.some(
          (later) =>
            later.dateUtc > reading.day &&
            later.createdAt.getTime() <=
              new Date(reading.first_stored_at).getTime(),
        ),
    )
    .map((reading) => reading.day);
  const datesWithReadings = Array.from(readingDays, (entry) => entry.day);
  return {
    gaps: findDailySeriesGaps({
      datesWithReadings,
      publishedDates: published,
      explainedDates: [...explained, ...lateOnly],
    }),
    daysWithReadings: datesWithReadings.length,
  };
}
