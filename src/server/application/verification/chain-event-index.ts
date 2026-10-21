import { and, eq, isNotNull, min } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import {
  createDeviceEventChainReader,
  MAX_LOG_RANGE_BLOCKS,
  type ChainDeviceEventLog,
  type DeviceEventChainReader,
} from '@/server/infrastructure/blockchain/device-event-chain-reader';
import type { Database } from '@/server/infrastructure/db/client';
import {
  chainDeviceEvents,
  chainScanCursors,
  deviceEvents,
} from '@/server/infrastructure/db/schema';
import { fetchTokenDeviceEventsFromExplorer } from '@/server/infrastructure/explorer/blockscout-client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'chain-event-index' });

/** Per sweep: at most this many 2k-block requests (stays under RPC limits). */
const MAX_SCAN_CHUNKS_PER_RUN = 10;

export async function recordChainEvents(
  db: Database,
  input: {
    chainId: bigint;
    logs: readonly (ChainDeviceEventLog & { blockTimestamp?: Date | null })[];
    via: 'scan' | 'explorer';
  },
): Promise<number> {
  if (input.logs.length === 0) {
    return 0;
  }
  const inserted = await db
    .insert(chainDeviceEvents)
    .values(
      input.logs.map((entry) => ({
        chainId: input.chainId,
        contractAddress: entry.contractAddress.toLowerCase(),
        tokenId: entry.tokenId.toString(),
        eventType: entry.eventType,
        transactionHash: entry.transactionHash.toLowerCase(),
        blockNumber: entry.blockNumber,
        logIndex: entry.logIndex,
        dataHash: entry.dataHash,
        payloadUtf8: entry.dataUtf8,
        blockTimestamp: entry.blockTimestamp ?? null,
        discoveredVia: input.via,
      })),
    )
    .onConflictDoNothing({
      target: [
        chainDeviceEvents.chainId,
        chainDeviceEvents.transactionHash,
        chainDeviceEvents.logIndex,
      ],
    })
    .returning({ id: chainDeviceEvents.id });
  return inserted.length;
}

export type ScanResult =
  | { status: 'unconfigured' }
  | { status: 'scanned'; fromBlock: bigint; toBlock: bigint; found: number }
  | { status: 'up_to_date'; lastScannedBlock: bigint };

/**
 * Reads new DeviceEvent logs (any token, any writer) forward from a stored
 * cursor, in ≤2k-block requests, only up to final blocks. Starts just before
 * this app's first anchored event, so nothing we published is skipped.
 * Idempotent: re-scanning a range inserts nothing new.
 */
export async function scanChainForward(
  db: Database,
  readerOverride?: DeviceEventChainReader,
): Promise<ScanResult> {
  const env = getServerEnv();
  const contract = env.DEVICE_NFT_CONTRACT_ADDRESS?.toLowerCase();
  if (contract === undefined || !env.USE_ARC_NETWORK) {
    return { status: 'unconfigured' };
  }
  const reader = readerOverride ?? createDeviceEventChainReader();
  const latest = await reader.latestBlockNumber();
  const finalHead = latest - BigInt(env.ARC_REQUIRED_CONFIRMATIONS);

  const [cursor] = await db
    .select()
    .from(chainScanCursors)
    .where(
      and(
        eq(chainScanCursors.chainId, reader.chainId),
        eq(chainScanCursors.contractAddress, contract),
      ),
    )
    .limit(1);
  let start: bigint;
  if (cursor !== undefined) {
    start = cursor.lastScannedBlock + 1n;
  } else {
    const [first] = await db
      .select({ block: min(deviceEvents.blockNumber) })
      .from(deviceEvents)
      .where(isNotNull(deviceEvents.blockNumber));
    start =
      first?.block !== null && first?.block !== undefined
        ? first.block - 1n
        : finalHead - MAX_LOG_RANGE_BLOCKS + 1n;
  }
  if (start > finalHead) {
    return { status: 'up_to_date', lastScannedBlock: start - 1n };
  }

  let from = start;
  let found = 0;
  let scannedTo = start - 1n;
  for (
    let chunk = 0;
    chunk < MAX_SCAN_CHUNKS_PER_RUN && from <= finalHead;
    chunk += 1
  ) {
    const to =
      from + MAX_LOG_RANGE_BLOCKS - 1n > finalHead
        ? finalHead
        : from + MAX_LOG_RANGE_BLOCKS - 1n;
    const logs = await reader.readDeviceEventLogs({
      contractAddress: contract,
      fromBlock: from,
      toBlock: to,
    });
    found += await recordChainEvents(db, {
      chainId: reader.chainId,
      logs,
      via: 'scan',
    });
    scannedTo = to;
    await db
      .insert(chainScanCursors)
      .values({
        chainId: reader.chainId,
        contractAddress: contract,
        lastScannedBlock: scannedTo,
      })
      .onConflictDoUpdate({
        target: [chainScanCursors.chainId, chainScanCursors.contractAddress],
        set: { lastScannedBlock: scannedTo, updatedAt: new Date() },
      });
    from = to + 1n;
  }
  if (found > 0) {
    log.info('chain_scan.found', {
      found,
      fromBlock: start.toString(),
      toBlock: scannedTo.toString(),
    });
  }
  return { status: 'scanned', fromBlock: start, toBlock: scannedTo, found };
}

export type BackfillResult =
  | { status: 'unconfigured' }
  | { status: 'explorer_unavailable'; reason: 'unavailable' | 'blocked' }
  | { status: 'backfilled'; found: number; inserted: number };

/** A token's full history from the explorer (discovery, not proof). */
export async function backfillTokenFromExplorer(
  db: Database,
  tokenId: bigint,
): Promise<BackfillResult> {
  const env = getServerEnv();
  const contract = env.DEVICE_NFT_CONTRACT_ADDRESS;
  if (contract === undefined) {
    return { status: 'unconfigured' };
  }
  const result = await fetchTokenDeviceEventsFromExplorer({
    contractAddress: contract,
    tokenId,
  });
  if (!result.ok) {
    return { status: 'explorer_unavailable', reason: result.reason };
  }
  const inserted = await recordChainEvents(db, {
    chainId: BigInt(env.ARC_CHAIN_ID),
    logs: result.logs,
    via: 'explorer',
  });
  return { status: 'backfilled', found: result.logs.length, inserted };
}
