import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { getAdminDeviceDetail } from '@/server/application/admin/admin-device-detail';
import { listAdminDevices } from '@/server/application/admin/admin-devices';
import { listAdminRecords } from '@/server/application/admin/admin-records';
import {
  recordChainEvents,
  scanChainForward,
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
} from '@/server/infrastructure/db/schema';

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
  },
) {
  const [row] = await db
    .insert(deviceEvents)
    .values({
      deviceId,
      eventType: input.sourceType === 'daily_odometer' ? 12 : 2,
      sourceType: input.sourceType ?? 'charging_session',
      sourceId: input.sourceId ?? randomUUID(),
      occurredAt: new Date('2031-05-01T10:00:00Z'),
      payloadJson: '{"vehicleId":"x"}',
      payloadHash: `0x${'bb'.repeat(32)}`,
      status: input.status,
      verificationStatus: input.verificationStatus ?? 'unchecked',
      ...(input.status === 'confirmed'
        ? {
            transactionHash: input.transactionHash ?? tx(),
            tokenId: '900',
            blockNumber: 5000n,
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
        chainLog({ tokenId: 903n, transactionHash: matchedTx }),
        chainLog({ tokenId: 903n, logIndex: 1 }), // written by someone else
      ],
    });

    const detail = await getAdminDeviceDetail(db, device.id);
    expect(detail?.summary).toEqual({
      matched: 1,
      anchoredNotIndexed: 1,
      missingOnChain: 1,
      onChainOnly: 1,
    });
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
