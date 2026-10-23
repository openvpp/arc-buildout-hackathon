import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { keccak256, stringToHex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

import {
  computeRecordHash,
  recomputeEventRecord,
} from '@/server/application/telemetry/device-event-record';
import { publishDeviceEvent } from '@/server/application/telemetry/publish-device-event';
import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import {
  enqueueDueVerifications,
  latestVerification,
  markVerificationJobFailed,
  pruneFinishedVerificationJobs,
  requestVerificationNow,
  verifyStoredDeviceEvent,
  VERIFY_DEVICE_EVENT_JOB,
} from '@/server/application/verification/verify-stored-event';
import type { VerificationPolicy } from '@/server/application/verification/verify-device-event';
import type { DeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import type { DeviceEventRecorder } from '@/server/infrastructure/blockchain/device-event-recorder';
import {
  chargingSessions,
  deviceEvents,
  devices,
  outboxEvents,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const CONTRACT = '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908';
const WRITER = '0x0e12c056a563c7ebc652e288e09c9be524044cea';
const policy: VerificationPolicy = {
  requiredConfirmations: 3n,
  trustedWriters: [WRITER],
  maxAnchorDelaySeconds: 3650 * 86_400,
  clockSkewSeconds: 300,
};

async function seedMintedDevice() {
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
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return device;
}

async function completeChargingSession(externalDeviceId: string) {
  for (const [at, isCharging, batteryLevel] of [
    ['2031-03-01T10:00:00Z', true, 40],
    ['2031-03-01T11:00:00Z', false, 80],
  ] as const) {
    await processEnodeWebhook(db, {
      rawBody: JSON.stringify([
        {
          event: 'user:vehicle:updated',
          createdAt: at,
          vehicle: {
            id: externalDeviceId,
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
}

const fakeRecorder: DeviceEventRecorder = {
  chainId: 5042002n,
  contractAddress: CONTRACT,
  async recordDeviceEvent(input) {
    const hash = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`;
    await input.onBroadcast(hash);
    return { outcome: 'confirmed', transactionHash: hash, blockNumber: 1000n };
  },
  reconcileDeviceEvent: async () => ({ outcome: 'pending' }),
};

/** A chain that holds exactly the published bytes of `payloadJson`. */
function fakeChain(input: {
  transactionHash: string;
  payloadJson: string;
  sender?: string;
}): DeviceEventChainReader {
  return {
    chainId: 5042002n,
    rpcHost: 'rpc.test',
    latestBlockNumber: async () => 2000n,
    readBlock: async (number) => ({
      number,
      timestamp: BigInt(Date.parse('2031-03-01T11:05:00Z') / 1000),
      senderOf: (hash) =>
        hash.toLowerCase() === input.transactionHash.toLowerCase()
          ? (input.sender ?? WRITER)
          : null,
    }),
    readDeviceEventLogs: async ({ fromBlock }) => [
      {
        contractAddress: CONTRACT,
        blockNumber: fromBlock,
        transactionHash: input.transactionHash,
        logIndex: 0,
        tokenId: 82n,
        eventType: 2,
        dataHash: keccak256(stringToHex(input.payloadJson)),
        dataUtf8: input.payloadJson,
        eventTimestamp: 0n,
      },
    ],
    findTransactionBlock: async () => 1000n,
  };
}

async function publishedEvent() {
  const device = await seedMintedDevice();
  await completeChargingSession(device.externalDeviceId);
  const [queued] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, device.id));
  if (queued === undefined) {
    throw new Error('expected a queued event');
  }
  await publishDeviceEvent({
    db,
    deviceEventId: queued.id,
    recorderOverride: fakeRecorder,
  });
  const [event] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.id, queued.id));
  if (event?.transactionHash == null) {
    throw new Error('expected a confirmed event');
  }
  return { device, event, transactionHash: event.transactionHash };
}

describe('verifyStoredDeviceEvent', () => {
  it('verifies a published event against the chain and records the result', async () => {
    const { event, transactionHash } = await publishedEvent();

    const result = await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'admin:Admin',
      readerOverride: fakeChain({
        transactionHash,
        payloadJson: event.payloadJson,
      }),
      policyOverride: policy,
    });
    expect(result.verdict).toBe('verified');
    expect(
      result.checks.find((c) => c.id === 'record_commitment')?.status,
    ).toBe('pass');

    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, event.id));
    expect(row?.verificationStatus).toBe('verified');
    expect((await latestVerification(db, event.id))?.checkedBy).toBe(
      'admin:Admin',
    );
  });

  it('marks a record unverified when its private data changed after anchoring', async () => {
    const { device, event, transactionHash } = await publishedEvent();
    await db
      .update(chargingSessions)
      .set({ energyDeliveredKwh: '45.0000' })
      .where(eq(chargingSessions.deviceId, device.id));

    const result = await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'worker',
      readerOverride: fakeChain({
        transactionHash,
        payloadJson: event.payloadJson,
      }),
      policyOverride: policy,
    });
    expect(result.verdict).toBe('unverified');
    expect(
      result.checks.find((c) => c.id === 'record_commitment')?.status,
    ).toBe('fail');
  });

  it('ignores a database record_hash rewritten to match tampered data', async () => {
    const { device, event, transactionHash } = await publishedEvent();
    await db
      .update(chargingSessions)
      .set({ energyDeliveredKwh: '45.0000' })
      .where(eq(chargingSessions.deviceId, device.id));
    // The attacker also "fixes" the stored commitment and activity time.
    const rebuilt = await recomputeEventRecord(db, {
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      snapshotJson: event.recordJson ?? '',
    });
    if (rebuilt.status !== 'ok' || event.recordSalt === null) {
      throw new Error('expected a rebuildable v2 record');
    }
    await db
      .update(deviceEvents)
      .set({
        recordHash: computeRecordHash(event.recordSalt, rebuilt.recordJson),
        occurredAt: new Date('2031-03-01T11:04:00Z'),
      })
      .where(eq(deviceEvents.id, event.id));

    const result = await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'worker',
      readerOverride: fakeChain({
        transactionHash,
        payloadJson: event.payloadJson,
      }),
      policyOverride: policy,
    });
    expect(result.verdict).toBe('unverified');
    expect(
      result.checks.find((c) => c.id === 'record_commitment')?.status,
    ).toBe('fail');
  });

  it('records no verdict when the chain cannot be read', async () => {
    const { event, transactionHash } = await publishedEvent();
    await expect(
      verifyStoredDeviceEvent({
        db,
        deviceEventId: event.id,
        checkedBy: 'worker',
        readerOverride: {
          ...fakeChain({ transactionHash, payloadJson: event.payloadJson }),
          readBlock: async () => {
            throw new Error('429 Too Many Requests');
          },
        },
        policyOverride: policy,
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
    expect(await latestVerification(db, event.id)).toBeNull();
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, event.id));
    expect(row?.verificationStatus).toBe('unchecked');
  });

  it('does not re-check a record anchored on another chain', async () => {
    const { event, transactionHash } = await publishedEvent();
    await db
      .update(deviceEvents)
      .set({ chainId: 1n })
      .where(eq(deviceEvents.id, event.id));
    await expect(
      verifyStoredDeviceEvent({
        db,
        deviceEventId: event.id,
        checkedBy: 'worker',
        readerOverride: fakeChain({
          transactionHash,
          payloadJson: event.payloadJson,
        }),
        policyOverride: policy,
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_UNAVAILABLE' });
    expect(await latestVerification(db, event.id)).toBeNull();
  });

  it('marks an anchor by an unknown writer unverified', async () => {
    const { event, transactionHash } = await publishedEvent();
    const result = await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'public',
      readerOverride: fakeChain({
        transactionHash,
        payloadJson: event.payloadJson,
        sender: '0x000000000000000000000000000000000000dEaD',
      }),
      policyOverride: policy,
    });
    expect(result.verdict).toBe('unverified');
  });

  it('reports an unanchored event as pending without touching the chain', async () => {
    const device = await seedMintedDevice();
    await completeChargingSession(device.externalDeviceId);
    const [queued] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, device.id));
    const result = await verifyStoredDeviceEvent({
      db,
      deviceEventId: queued?.id ?? '',
      checkedBy: 'worker',
      readerOverride: {
        ...fakeChain({ transactionHash: '0x', payloadJson: '' }),
        latestBlockNumber: () => {
          throw new Error('must not read the chain');
        },
      },
      policyOverride: policy,
    });
    expect(result.verdict).toBe('pending');
  });

  it('queues an independent verification when an event confirms', async () => {
    const { event } = await publishedEvent();
    const jobs = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, VERIFY_DEVICE_EVENT_JOB),
          eq(outboxEvents.aggregateId, event.id),
        ),
      );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  async function verifyJobsFor(deviceEventId: string) {
    return db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, VERIFY_DEVICE_EVENT_JOB),
          eq(outboxEvents.aggregateId, deviceEventId),
        ),
      );
  }

  it('backfills verification for confirmed events never checked', async () => {
    const { event } = await publishedEvent();
    await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, event.id));

    expect(await enqueueDueVerifications(db)).toBeGreaterThanOrEqual(1);
    // Idempotent while the job is still queued.
    await enqueueDueVerifications(db);
    expect(await verifyJobsFor(event.id)).toHaveLength(1);
  });

  it('backs off a record whose verify job ran out of attempts', async () => {
    const { event } = await publishedEvent();
    await db
      .update(outboxEvents)
      .set({ status: 'failed', processedAt: new Date() })
      .where(eq(outboxEvents.aggregateId, event.id));
    const now = new Date();
    await markVerificationJobFailed(db, event.id, now);

    // Not re-queued every minute…
    await enqueueDueVerifications(db, {
      now: new Date(now.getTime() + 60_000),
    });
    expect(
      (await verifyJobsFor(event.id)).filter((j) => j.status === 'pending'),
    ).toHaveLength(0);

    // …but again once the backoff (15 min after the first failure) is due.
    await enqueueDueVerifications(db, {
      now: new Date(now.getTime() + 16 * 60_000),
    });
    expect(
      (await verifyJobsFor(event.id)).filter((j) => j.status === 'pending'),
    ).toHaveLength(1);

    // The backoff doubles with each exhausted job.
    await markVerificationJobFailed(db, event.id, now);
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, event.id));
    expect(row?.verificationAttempts).toBe(2);
    expect(row?.verificationNextCheckAt?.getTime()).toBe(
      now.getTime() + 30 * 60_000,
    );
  });

  it('re-queues a pending verdict whose job was lost', async () => {
    const { event, transactionHash } = await publishedEvent();
    // Not final yet → pending verdict.
    await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'worker',
      readerOverride: {
        ...fakeChain({ transactionHash, payloadJson: event.payloadJson }),
        latestBlockNumber: async () => 1000n,
      },
      policyOverride: policy,
    });
    await db.delete(outboxEvents).where(eq(outboxEvents.aggregateId, event.id));

    await enqueueDueVerifications(db);
    expect(await verifyJobsFor(event.id)).toHaveLength(0);
    await enqueueDueVerifications(db, {
      now: new Date(Date.now() + 11 * 60_000),
    });
    expect(await verifyJobsFor(event.id)).toHaveLength(1);
  });

  it('a recorded verdict clears the backoff', async () => {
    const { event, transactionHash } = await publishedEvent();
    await markVerificationJobFailed(db, event.id);
    await verifyStoredDeviceEvent({
      db,
      deviceEventId: event.id,
      checkedBy: 'worker',
      readerOverride: fakeChain({
        transactionHash,
        payloadJson: event.payloadJson,
      }),
      policyOverride: policy,
    });
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, event.id));
    expect(row).toMatchObject({
      verificationAttempts: 0,
      verificationNextCheckAt: null,
    });
  });

  it('"verify all" moves queued checks to now and resets the backoff', async () => {
    const { event } = await publishedEvent();
    await markVerificationJobFailed(db, event.id);
    // The confirmation's own job is still pending, in the future.
    expect(await requestVerificationNow(db, [event.id])).toBe(1);
    const jobs = await verifyJobsFor(event.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.availableAt.getTime()).toBeLessThanOrEqual(Date.now());
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, event.id));
    expect(row?.verificationNextCheckAt).toBeNull();
  });

  it('prunes finished verify jobs past retention only', async () => {
    const { event } = await publishedEvent();
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await db
      .update(outboxEvents)
      .set({ status: 'completed', processedAt: old })
      .where(eq(outboxEvents.aggregateId, event.id));
    const fresh = await publishedEvent();
    await db
      .update(outboxEvents)
      .set({ status: 'failed', processedAt: new Date() })
      .where(eq(outboxEvents.aggregateId, fresh.event.id));

    expect(await pruneFinishedVerificationJobs(db)).toBeGreaterThanOrEqual(1);
    expect(await verifyJobsFor(event.id)).toHaveLength(0);
    expect(await verifyJobsFor(fresh.event.id)).toHaveLength(1);
  });
});
