import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { getAdminDeviceDetail } from '@/server/application/admin/admin-device-detail';
import { listAdminDevices } from '@/server/application/admin/admin-devices';
import { listAdminRecords } from '@/server/application/admin/admin-records';
import {
  recordChainEvents,
  scanChainForward,
  SCAN_OVERLAP_BLOCKS,
} from '@/server/application/verification/chain-event-index';
import { getServerEnv } from '@/server/config/env';
import type {
  ChainDeviceEventLog,
  DeviceEventChainReader,
} from '@/server/infrastructure/blockchain/device-event-chain-reader';
import {
  chainDeviceEvents,
  chainScanCursors,
  dailyOdometer,
  deviceEvents,
  devices,
  odometerReadings,
  outboxEvents,
} from '@/server/infrastructure/db/schema';
import { runWorkerCycle } from '@/server/infrastructure/jobs/worker';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const env = getServerEnv();
const CONTRACT = (
  env.DEVICE_NFT_CONTRACT_ADDRESS ??
  '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908'
).toLowerCase();
const CHAIN_ID = BigInt(env.ARC_CHAIN_ID);
const tx = () => `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`;
/** Payload hash seedRecord gives a record; a chain log matches with it. */
const RECORD_HASH = `0x${'bb'.repeat(32)}`;

function chainLog(
  overrides: Partial<ChainDeviceEventLog>,
): ChainDeviceEventLog {
  return {
    contractAddress: CONTRACT,
    blockNumber: 5000n,
    transactionHash: tx(),
    logIndex: 0,
    tokenId: 900n,
    eventType: 2,
    dataHash: `0x${'aa'.repeat(32)}`,
    dataUtf8: '{}',
    eventTimestamp: 0n,
    ...overrides,
  };
}

async function seedDevice(tokenId: string) {
  const { wallet } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId: randomUUID(),
      mintStatus: 'minted',
      nftTokenId: tokenId,
      nftContractAddress: CONTRACT,
    })
    .returning();
  if (device === undefined) throw new Error('seed failed');
  return device;
}

async function seedRecord(
  deviceId: string,
  input: {
    status: 'queued' | 'confirmed' | 'failed';
    transactionHash?: string;
    verificationStatus?: 'unchecked' | 'verified' | 'unverified';
    sourceType?: 'charging_session' | 'daily_odometer';
    sourceId?: string;
    occurredAt?: Date;
    payloadHash?: string;
    blockNumber?: bigint;
  },
) {
  const [row] = await db
    .insert(deviceEvents)
    .values({
      deviceId,
      eventType: input.sourceType === 'daily_odometer' ? 12 : 2,
      sourceType: input.sourceType ?? 'charging_session',
      sourceId: input.sourceId ?? randomUUID(),
      occurredAt: input.occurredAt ?? new Date('2031-05-01T10:00:00Z'),
      payloadJson: '{"vehicleId":"x"}',
      payloadHash: input.payloadHash ?? RECORD_HASH,
      status: input.status,
      verificationStatus: input.verificationStatus ?? 'unchecked',
      ...(input.status === 'confirmed'
        ? {
            transactionHash: input.transactionHash ?? tx(),
            tokenId: '900',
            blockNumber: input.blockNumber ?? 5000n,
            confirmedAt: new Date(),
          }
        : {}),
    })
    .returning();
  if (row === undefined) throw new Error('seed failed');
  return row;
}

describe('chain event index', () => {
  it('stores each on-chain log once', async () => {
    const entry = chainLog({ tokenId: 901n });
    expect(
      await recordChainEvents(db, {
        chainId: CHAIN_ID,
        logs: [entry],
        via: 'scan',
      }),
    ).toBe(1);
    expect(
      await recordChainEvents(db, {
        chainId: CHAIN_ID,
        logs: [entry],
        via: 'explorer',
      }),
    ).toBe(0);
  });

  it('scans forward in bounded chunks from just before our first anchor', async () => {
    const device = await seedDevice('902');
    await seedRecord(device.id, { status: 'confirmed' }); // block 5000
    await db.delete(chainScanCursors);
    const ranges: [bigint, bigint][] = [];
    const reader: DeviceEventChainReader = {
      chainId: CHAIN_ID,
      rpcHost: 'rpc.test',
      latestBlockNumber: async () => 12_003n,
      readBlock: async () => null,
      readDeviceEventLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        return fromBlock <= 5000n && 5000n <= toBlock
          ? [chainLog({ tokenId: 902n, blockNumber: 5000n })]
          : [];
      },
      findTransactionBlock: async () => null,
    };

    const first = await scanChainForward(db, reader);
    expect(first).toMatchObject({
      status: 'scanned',
      fromBlock: 4999n,
      found: 1,
    });
    // Stops at the final head (latest - confirmations), in ≤2000-block requests.
    const finalHead = 12_003n - BigInt(env.ARC_REQUIRED_CONFIRMATIONS);
    expect(ranges.at(-1)?.[1]).toBe(finalHead);
    expect(ranges.every(([from, to]) => to - from + 1n <= 2000n)).toBe(true);

    const second = await scanChainForward(db, reader);
    expect(second.status).toBe('up_to_date');
  });

  it('re-reads an overlap behind the cursor and never moves it back', async () => {
    const device = await seedDevice('907');
    await seedRecord(device.id, { status: 'confirmed' });
    await db.delete(chainScanCursors);
    const ranges: [bigint, bigint][] = [];
    let head = 6_003n;
    const reader: DeviceEventChainReader = {
      chainId: CHAIN_ID,
      rpcHost: 'rpc.test',
      latestBlockNumber: async () => head,
      readBlock: async () => null,
      readDeviceEventLogs: async ({ fromBlock, toBlock }) => {
        ranges.push([fromBlock, toBlock]);
        return [];
      },
      findTransactionBlock: async () => null,
    };
    await scanChainForward(db, reader);
    const [after] = await db.select().from(chainScanCursors);
    const cursor = after?.lastScannedBlock ?? 0n;

    head += 50n;
    ranges.length = 0;
    await scanChainForward(db, reader);
    expect(ranges[0]?.[0]).toBe(cursor + 1n - SCAN_OVERLAP_BLOCKS);
    const [moved] = await db.select().from(chainScanCursors);
    expect(moved?.lastScannedBlock).toBe(cursor + 50n);

    // A scan past its deadline starts no RPC requests.
    head += 50n;
    ranges.length = 0;
    await scanChainForward(db, reader, Date.now() - 1);
    expect(ranges).toHaveLength(0);
  });
});

describe('getAdminDeviceDetail reconciliation', () => {
  it('matches our records to the chain and flags missing and orphan anchors', async () => {
    const device = await seedDevice('903');
    const matchedTx = tx();
    await seedRecord(device.id, {
      status: 'confirmed',
      transactionHash: matchedTx,
      verificationStatus: 'verified',
    });
    await seedRecord(device.id, { status: 'confirmed' }); // anchored, not indexed
    await seedRecord(device.id, { status: 'queued' }); // missing on-chain
    await recordChainEvents(db, {
      chainId: CHAIN_ID,
      via: 'scan',
      logs: [
        chainLog({
          tokenId: 903n,
          transactionHash: matchedTx,
          dataHash: RECORD_HASH,
        }),
        chainLog({ tokenId: 903n, logIndex: 1 }), // written by someone else
      ],
    });

    const detail = await getAdminDeviceDetail(db, device.id);
    expect(detail?.summary).toEqual({
      matched: 1,
      anchoredNotIndexed: 1,
      missingOnChain: 1,
      conflict: 0,
      onChainOnly: 1,
    });
  });

  it("pairs records and anchors outside each other's window", async () => {
    const device = await seedDevice('908');
    // Activity order and anchoring order are reversed (e.g. a record held
    // for its mint): the newest-2 records and newest-2 logs differ.
    const txs = [tx(), tx(), tx()];
    for (const [i, hash] of txs.entries()) {
      await seedRecord(device.id, {
        status: 'confirmed',
        transactionHash: hash,
        occurredAt: new Date(Date.UTC(2031, 6, 1 + i)),
        blockNumber: BigInt(9000 - i),
      });
    }
    await recordChainEvents(db, {
      chainId: CHAIN_ID,
      via: 'scan',
      logs: txs.map((hash, i) =>
        chainLog({
          tokenId: 908n,
          transactionHash: hash,
          blockNumber: BigInt(9000 - i),
          dataHash: RECORD_HASH,
        }),
      ),
    });

    const detail = await getAdminDeviceDetail(db, device.id, 2);
    expect(detail?.summary).toMatchObject({
      matched: 3,
      anchoredNotIndexed: 0,
      onChainOnly: 0,
    });
    expect(detail?.truncated).toBe(true);
  });

  it('flags different on-chain data and keeps every log of a transaction', async () => {
    const device = await seedDevice('909');
    const ours = tx();
    const other = tx();
    await seedRecord(device.id, { status: 'confirmed', transactionHash: ours });
    await seedRecord(device.id, {
      status: 'confirmed',
      transactionHash: other,
    });
    await recordChainEvents(db, {
      chainId: CHAIN_ID,
      via: 'scan',
      logs: [
        // Our tx carries our event plus a foreign one.
        chainLog({
          tokenId: 909n,
          transactionHash: ours,
          dataHash: RECORD_HASH,
        }),
        chainLog({ tokenId: 909n, transactionHash: ours, logIndex: 1 }),
        // This record's tx holds different bytes than we recorded.
        chainLog({ tokenId: 909n, transactionHash: other }),
      ],
    });

    const detail = await getAdminDeviceDetail(db, device.id);
    expect(detail?.summary).toMatchObject({
      matched: 1,
      conflict: 1,
      onChainOnly: 1,
    });
  });

  it('does not count a day whose readings all arrived late as a gap', async () => {
    const device = await seedDevice('910');
    // 07-01 and 07-03 are rolled up; a reading observed on 07-02 is stored
    // only afterwards, so it is kept raw and never gets its own day.
    for (const dateUtc of ['2031-07-01', '2031-07-03']) {
      await db.insert(dailyOdometer).values({
        deviceId: device.id,
        dateUtc,
        startOdometerKm: '1000.000',
        endOdometerKm: '1000.000',
        status: 'finalized',
        finalizedAt: new Date(),
        createdAt: new Date(Date.now() - 60_000),
      });
    }
    await db.insert(odometerReadings).values({
      deviceId: device.id,
      observedAt: new Date('2031-07-02T08:00:00Z'),
      odometerKm: '1000.000',
    });

    const detail = await getAdminDeviceDetail(db, device.id);
    expect(detail?.completeness.gaps).not.toContain('2031-07-02');
  });

  it('reports a day with readings that was never published as a gap', async () => {
    const device = await seedDevice('904');
    for (const at of ['2031-06-01T08:00:00Z', '2031-06-02T08:00:00Z']) {
      await db.insert(odometerReadings).values({
        deviceId: device.id,
        observedAt: new Date(at),
        odometerKm: '1000.000',
      });
    }
    // 06-01 published; 06-02 finalized with distance but never queued.
    const [published] = await db
      .insert(dailyOdometer)
      .values({
        deviceId: device.id,
        dateUtc: '2031-06-01',
        startOdometerKm: '900.000',
        endOdometerKm: '1000.000',
        status: 'finalized',
        finalizedAt: new Date(),
      })
      .returning();
    await seedRecord(device.id, {
      status: 'confirmed',
      sourceType: 'daily_odometer',
      sourceId: published?.id ?? '',
    });
    await db.insert(dailyOdometer).values({
      deviceId: device.id,
      dateUtc: '2031-06-02',
      startOdometerKm: '1000.000',
      endOdometerKm: '1050.000',
      status: 'finalized',
      finalizedAt: new Date(),
    });

    const detail = await getAdminDeviceDetail(db, device.id);
    expect(detail?.completeness).toEqual({
      gaps: ['2031-06-02'],
      daysWithReadings: 2,
    });
  });
});

describe('admin lists', () => {
  it('lists devices with record counts and filters records by verdict', async () => {
    const device = await seedDevice('905');
    await seedRecord(device.id, {
      status: 'confirmed',
      verificationStatus: 'unverified',
    });
    const bare = await seedDevice('906');

    const withRecords = await listAdminDevices(db, {
      onlyWithRecords: true,
      limit: 100,
    });
    const row = withRecords.devices.find((d) => d.id === device.id);
    expect(row?.records).toMatchObject({
      total: 1,
      anchored: 1,
      unverified: 1,
    });
    expect(withRecords.devices.some((d) => d.id === bare.id)).toBe(false);

    const unverified = await listAdminRecords(db, {
      verdict: 'unverified',
      limit: 100,
    });
    expect(unverified.records.some((r) => r.deviceId === device.id)).toBe(true);
    expect(
      unverified.records.every((r) => r.verificationStatus === 'unverified'),
    ).toBe(true);

    const index = await db
      .select()
      .from(chainDeviceEvents)
      .where(eq(chainDeviceEvents.tokenId, '905'));
    expect(index).toHaveLength(0);
  });
});

describe('admin device paging', () => {
  it('does not skip devices that share a millisecond', async () => {
    const ids: string[] = [];
    for (const micro of ['111', '222', '333']) {
      const device = await seedDevice('');
      // Raw client: set a microsecond timestamp drizzle would round.
      await sql`update devices set created_at = ${`2040-01-01 00:00:00.123${micro}+00`}::timestamptz where id = ${device.id}`;
      ids.push(device.id);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await listAdminDevices(db, {
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...result.devices.map((d) => d.id));
      if (result.nextCursor === null || ids.every((id) => seen.includes(id)))
        break;
      cursor = result.nextCursor;
    }
    expect(ids.every((id) => seen.includes(id))).toBe(true);
  });
});

describe('worker job order', () => {
  it('runs on-chain writes before older verification jobs', async () => {
    await db.delete(outboxEvents);
    const earlier = new Date(Date.now() - 60_000);
    await db.insert(outboxEvents).values([
      {
        aggregateType: 'device_event',
        aggregateId: randomUUID(),
        eventType: 'VERIFY_DEVICE_EVENT',
        payload: { deviceEventId: randomUUID() },
        availableAt: earlier,
      },
      {
        aggregateType: 'device_event',
        aggregateId: randomUUID(),
        eventType: 'RECORD_DEVICE_EVENT',
        // Unknown event: the attempt errors and is rescheduled.
        payload: { deviceEventId: randomUUID() },
      },
    ]);
    await runWorkerCycle(db);
    const rows = await db.select().from(outboxEvents);
    const verify = rows.find((r) => r.eventType === 'VERIFY_DEVICE_EVENT');
    const record = rows.find((r) => r.eventType === 'RECORD_DEVICE_EVENT');
    expect(record?.attempts).toBe(1);
    expect(verify).toMatchObject({ status: 'pending', attempts: 0 });
  });
});
