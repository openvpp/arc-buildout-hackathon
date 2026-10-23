import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { keccak256, stringToHex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

import { publishDeviceEvent } from '@/server/application/telemetry/publish-device-event';
import {
  getPublicEventVerification,
  verifyClaim,
} from '@/server/application/verification/public-verification';
import { buildVerificationSpec } from '@/server/application/verification/verification-spec';
import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import type { DeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import type { DeviceEventRecorder } from '@/server/infrastructure/blockchain/device-event-recorder';
import { resolveTrustedWriters } from '@/server/infrastructure/blockchain/trusted-writers';
import { getServerEnv } from '@/server/config/env';
import {
  deviceEvents,
  devices,
  eventVerifications,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const env = getServerEnv();
const CONTRACT =
  env.DEVICE_NFT_CONTRACT_ADDRESS ??
  '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908';
const WRITER =
  resolveTrustedWriters(env)[0] ?? '0x0e12c056a563c7ebc652e288e09c9be524044cea';

async function publishedEvent() {
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
      nftTokenId: '82',
      nftContractAddress: CONTRACT,
    })
    .returning();
  for (const [at, isCharging, batteryLevel] of [
    ['2031-04-01T10:00:00Z', true, 40],
    ['2031-04-01T11:00:00Z', false, 80],
  ] as const) {
    await processEnodeWebhook(db, {
      rawBody: JSON.stringify([
        {
          event: 'user:vehicle:updated',
          createdAt: at,
          vehicle: {
            id: device?.externalDeviceId,
            chargeState: {
              isCharging,
              batteryLevel,
              batteryCapacity: 75,
              lastUpdated: at,
            },
          },
        },
      ]),
      deliveryIdHeader: randomUUID(),
      signatureValid: true,
    });
  }
  const [queued] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, device?.id ?? ''));
  const recorder: DeviceEventRecorder = {
    chainId: 5042002n,
    contractAddress: CONTRACT,
    async recordDeviceEvent(input) {
      const hash = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`;
      await input.onBroadcast(hash);
      return {
        outcome: 'confirmed',
        transactionHash: hash,
        blockNumber: 1000n,
      };
    },
    reconcileDeviceEvent: async () => ({ outcome: 'pending' }),
  };
  await publishDeviceEvent({
    db,
    deviceEventId: queued?.id ?? '',
    recorderOverride: recorder,
  });
  const [event] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.id, queued?.id ?? ''));
  if (event?.transactionHash == null) {
    throw new Error('expected a confirmed event');
  }
  return { event, transactionHash: event.transactionHash };
}

function chain(input: {
  transactionHash: string;
  payloadJson: string;
  onRead?: () => void;
  knowsHash?: boolean;
}): DeviceEventChainReader {
  return {
    chainId: 5042002n,
    rpcHost: 'rpc.test',
    latestBlockNumber: async () => {
      input.onRead?.();
      return 2000n;
    },
    readBlock: async (number) => ({
      number,
      timestamp: BigInt(Date.parse('2031-04-01T11:02:00Z') / 1000),
      senderOf: (hash) =>
        hash.toLowerCase() === input.transactionHash.toLowerCase()
          ? WRITER
          : null,
    }),
    readDeviceEventLogs: async ({ fromBlock }) => [
      {
        contractAddress: CONTRACT,
        blockNumber: fromBlock,
        transactionHash: input.transactionHash,
        logIndex: 3,
        tokenId: 82n,
        eventType: 2,
        dataHash: keccak256(stringToHex(input.payloadJson)),
        dataUtf8: input.payloadJson,
        eventTimestamp: 0n,
      },
    ],
    findTransactionBlock: async () =>
      input.knowsHash === false ? null : 1000n,
  };
}

describe('getPublicEventVerification', () => {
  it('runs a live check once, then serves the cached result unless forced', async () => {
    const { event, transactionHash } = await publishedEvent();
    let reads = 0;
    const reader = chain({
      transactionHash,
      payloadJson: event.payloadJson,
      onRead: () => {
        reads += 1;
      },
    });

    const first = await getPublicEventVerification(db, {
      transactionHash,
      refresh: true,
      readerOverride: reader,
    });
    expect(first?.verification?.verdict).toBe('verified');
    expect(first?.verification?.checkedBy).toBe('public');

    await getPublicEventVerification(db, {
      transactionHash,
      refresh: true,
      readerOverride: reader,
    });
    expect(reads).toBe(1);

    await getPublicEventVerification(db, {
      transactionHash,
      refresh: true,
      force: true,
      readerOverride: reader,
    });
    expect(reads).toBe(2);
    const runs = await db
      .select()
      .from(eventVerifications)
      .where(eq(eventVerifications.deviceEventId, event.id));
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it('never exposes the private record or its salt', async () => {
    const { event, transactionHash } = await publishedEvent();
    const result = await getPublicEventVerification(db, {
      transactionHash,
      refresh: true,
      readerOverride: chain({
        transactionHash,
        payloadJson: event.payloadJson,
      }),
    });
    const body = JSON.stringify(result);
    expect(body).not.toContain(event.recordSalt ?? 'salt');
    expect(body).not.toContain('recordJson');
    expect(result?.reproduce.command).toContain('verify:standalone');
    expect(result?.reproduce.command).toContain('--writer 0x');
  });
});

describe('verifyClaim', () => {
  it('confirms a genuine payload and rejects a tampered one', async () => {
    const { event, transactionHash } = await publishedEvent();
    const reader = chain({ transactionHash, payloadJson: event.payloadJson });

    const genuine = await verifyClaim(
      db,
      { transactionHash, blockNumber: 1000n, payloadJson: event.payloadJson },
      reader,
    );
    expect(genuine.verdict).toBe('verified');
    expect(genuine.deviceEventId).toBe(event.id);

    const tampered = await verifyClaim(
      db,
      {
        transactionHash,
        blockNumber: 1000n,
        payloadJson: event.payloadJson.replace(
          '"energyDelivered":30',
          '"energyDelivered":45',
        ),
      },
      reader,
    );
    expect(tampered.verdict).toBe('unverified');
  });

  it('compares the device only against an independent expectation', async () => {
    const { event, transactionHash } = await publishedEvent();
    const reader = chain({ transactionHash, payloadJson: event.payloadJson });
    const deviceCheck = (result: Awaited<ReturnType<typeof verifyClaim>>) =>
      result.checks.find((c) => c.id === 'device_and_type')?.status;

    // Our own record supplies the expected token and type.
    expect(
      deviceCheck(
        await verifyClaim(
          db,
          {
            transactionHash,
            blockNumber: 1000n,
            payloadJson: event.payloadJson,
          },
          reader,
        ),
      ),
    ).toBe('pass');

    const wrongDevice = await verifyClaim(
      db,
      {
        transactionHash,
        blockNumber: 1000n,
        payloadJson: event.payloadJson,
        tokenId: 83n,
      },
      reader,
    );
    expect(deviceCheck(wrongDevice)).toBe('fail');
    expect(wrongDevice.verdict).toBe('unverified');

    // A transaction this app never recorded: nothing to compare against.
    const foreignTx = `0x${'ef'.repeat(32)}`;
    const foreign = await verifyClaim(
      db,
      {
        transactionHash: foreignTx,
        blockNumber: 1000n,
        payloadJson: event.payloadJson,
      },
      chain({ transactionHash: foreignTx, payloadJson: event.payloadJson }),
    );
    expect(deviceCheck(foreign)).toBe('skip');
  });

  it('reports an unreadable chain instead of a verdict', async () => {
    const tx = `0x${'ce'.repeat(32)}`;
    await expect(
      verifyClaim(
        db,
        { transactionHash: tx, blockNumber: 1000n, payloadJson: '{}' },
        {
          ...chain({ transactionHash: tx, payloadJson: '{}' }),
          latestBlockNumber: async () => {
            throw new Error('timeout');
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
  });

  it('asks for the block number when the RPC no longer indexes the hash', async () => {
    const tx = `0x${'cd'.repeat(32)}`;
    await expect(
      verifyClaim(
        db,
        { transactionHash: tx, payloadJson: '{}' },
        chain({ transactionHash: tx, payloadJson: '{}', knowsHash: false }),
      ),
    ).rejects.toMatchObject({ code: 'BLOCK_NUMBER_REQUIRED' });
  });
});

describe('verification spec', () => {
  it('publishes the rules and trusted writers, and no secrets', () => {
    const spec = buildVerificationSpec();
    expect(spec.checks.map((check) => check.id)).toEqual([
      'anchor_exists',
      'finality',
      'authorized_writer',
      'device_and_type',
      'content_hash',
      'stored_payload',
      'record_commitment',
      'anchor_timeliness',
    ]);
    expect(spec.contract.topic0).toBe(
      '0x3de799dd7abe8fd56ddf6376287c6702888d24fbc26726a7d9bbfab1c3c53962',
    );
    const body = JSON.stringify(spec);
    for (const secret of [
      env.API_KEY_HASH_SECRET,
      env.DEVICE_NFT_MINTER_PRIVATE_KEY,
      env.PRIVATE_KEY,
    ]) {
      if (secret !== undefined && secret.length > 0) {
        expect(body).not.toContain(secret);
      }
    }
  });
});
