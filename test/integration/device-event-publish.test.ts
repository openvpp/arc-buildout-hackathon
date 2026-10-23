import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { publishDeviceEvent } from '@/server/application/telemetry/publish-device-event';
import {
  queueChargingSessionEvent,
  RECORD_DEVICE_EVENT_JOB,
} from '@/server/application/telemetry/queue-device-event';
import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import {
  hashDeviceEventPayload,
  type DeviceEventRecorder,
} from '@/server/infrastructure/blockchain/device-event-recorder';
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

function fakeTxHash(): string {
  return `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`;
}

type RecordInput = Parameters<DeviceEventRecorder['recordDeviceEvent']>[0];

function makeFakeRecorder(
  behavior: {
    record?: (
      input: RecordInput,
    ) => ReturnType<DeviceEventRecorder['recordDeviceEvent']>;
    reconcile?: DeviceEventRecorder['reconcileDeviceEvent'];
  } = {},
): DeviceEventRecorder & { calls: RecordInput[] } {
  const recorder = {
    chainId: 5042002n,
    contractAddress: CONTRACT,
    calls: [] as RecordInput[],
    async recordDeviceEvent(input: RecordInput) {
      recorder.calls.push(input);
      if (behavior.record !== undefined) {
        return behavior.record(input);
      }
      const hash = fakeTxHash();
      await input.onBroadcast(hash);
      // Widen the race window for the concurrency test.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        outcome: 'confirmed' as const,
        transactionHash: hash,
        blockNumber: 123n,
      };
    },
    reconcileDeviceEvent:
      behavior.reconcile ?? (async () => ({ outcome: 'pending' as const })),
  };
  return recorder;
}

async function seedDevice(minted: boolean) {
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
      ...(minted
        ? {
            mintStatus: 'minted',
            nftTokenId: '77',
            nftContractAddress: CONTRACT,
          }
        : {}),
    })
    .returning();
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return device;
}

/** Drives a real webhook charge cycle so the event is queued the normal way. */
async function completeChargingSession(externalDeviceId: string) {
  for (const [at, isCharging, batteryLevel] of [
    ['2026-10-12T10:00:00Z', true, 40],
    ['2026-10-12T11:00:00Z', false, 80],
  ] as const) {
    await processEnodeWebhook(db, {
      rawBody: JSON.stringify([
        {
          event: 'user:vehicle:updated',
          createdAt: at,
          vehicle: {
            id: externalDeviceId,
            location: { latitude: 59.91, longitude: 10.75 },
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

async function eventsFor(deviceId: string) {
  return db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, deviceId));
}

describe('queueing CHARGING_COMPLETED', () => {
  it('queues one event and outbox job when a session completes', async () => {
    const device = await seedDevice(true);
    await completeChargingSession(device.externalDeviceId);

    const events = await eventsFor(device.id);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({ eventType: 2, status: 'queued' });
    expect(event?.payloadHash).toBe(
      hashDeviceEventPayload(event?.payloadJson ?? ''),
    );
    const payload = JSON.parse(event?.payloadJson ?? '{}') as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      vehicleId: device.id,
      energyDelivered: 30,
      method: 'estimated_from_battery_change',
      pointsAwarded: 30,
      electricityPrice: 0.12,
      totalCost: 3.6,
      currency: 'USD',
    });
    // The session had a location; it must not reach the payload.
    expect(event?.payloadJson).not.toContain('59.91');

    const jobs = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, RECORD_DEVICE_EVENT_JOB),
          eq(outboxEvents.aggregateId, event?.id ?? ''),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('queues a session at most once', async () => {
    const device = await seedDevice(true);
    await completeChargingSession(device.externalDeviceId);
    const [session] = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.deviceId, device.id));

    expect(await queueChargingSessionEvent(db, session?.id ?? '')).toEqual({
      status: 'exists',
    });
    expect(await eventsFor(device.id)).toHaveLength(1);
  });

  it('does not publish a session whose energy could not be measured', async () => {
    const device = await seedDevice(true);
    const [session] = await db
      .insert(chargingSessions)
      .values({
        deviceId: device.id,
        sessionId: randomUUID(),
        status: 'completed',
        startTime: new Date('2026-10-12T10:00:00Z'),
        endTime: new Date('2026-10-12T11:00:00Z'),
        energyMethod: 'unknown',
      })
      .returning();

    expect(await queueChargingSessionEvent(db, session?.id ?? '')).toEqual({
      status: 'skipped',
      reason: 'energy_not_measured',
    });
    expect(await eventsFor(device.id)).toHaveLength(0);
  });
});

describe('publishDeviceEvent', () => {
  async function queuedEventFor(minted: boolean) {
    const device = await seedDevice(minted);
    await completeChargingSession(device.externalDeviceId);
    const [event] = await eventsFor(device.id);
    if (event === undefined) {
      throw new Error('expected a queued event');
    }
    return { device, event };
  }

  it('waits, without claiming, while the device is unminted', async () => {
    const { event } = await queuedEventFor(false);
    const recorder = makeFakeRecorder();

    const result = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: recorder,
    });
    expect(result).toEqual({ status: 'waiting_for_mint' });
    expect(recorder.calls).toHaveLength(0);
    const [row] = await eventsFor(event.deviceId);
    expect(row?.status).toBe('queued');
  });

  it('records the frozen payload and confirms from the receipt', async () => {
    const { event } = await queuedEventFor(true);
    const recorder = makeFakeRecorder();

    const result = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: recorder,
    });
    expect(result.status).toBe('confirmed');
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]).toMatchObject({
      tokenId: 77n,
      eventType: 2,
      payloadJson: event.payloadJson,
      payloadHash: event.payloadHash,
    });

    const [row] = await eventsFor(event.deviceId);
    expect(row).toMatchObject({
      status: 'confirmed',
      tokenId: '77',
      chainId: 5042002n,
      contractAddress: CONTRACT,
      blockNumber: 123n,
    });
    expect(row?.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(row?.confirmedAt).not.toBeNull();
  });

  it('only one concurrent worker sends the transaction', async () => {
    const { event } = await queuedEventFor(true);
    const recorder = makeFakeRecorder();

    const results = await Promise.all([
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: recorder,
      }),
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: recorder,
      }),
    ]);

    expect(recorder.calls).toHaveLength(1);
    expect(results.map((r) => r.status).sort()).toEqual(['busy', 'confirmed']);
  });

  it('reconciles an in-flight tx after a crash instead of sending again', async () => {
    const { event } = await queuedEventFor(true);
    const broadcastHash = fakeTxHash();
    const crashing = makeFakeRecorder({
      record: async (input) => {
        await input.onBroadcast(broadcastHash);
        throw new Error('receipt timeout');
      },
    });
    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: crashing,
      }),
    ).rejects.toThrow('receipt timeout');

    const [afterCrash] = await eventsFor(event.deviceId);
    expect(afterCrash).toMatchObject({
      status: 'pending',
      transactionHash: broadcastHash,
      claimedAt: null,
    });

    const recovering = makeFakeRecorder({
      reconcile: async () => ({ outcome: 'confirmed', blockNumber: 456n }),
    });
    const result = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: recovering,
    });
    expect(result).toEqual({
      status: 'confirmed',
      transactionHash: broadcastHash,
    });
    expect(recovering.calls).toHaveLength(0);
    const [row] = await eventsFor(event.deviceId);
    expect(row).toMatchObject({ status: 'confirmed', blockNumber: 456n });
  });

  it('confirms and queues its verification together, or not at all', async () => {
    const { event } = await queuedEventFor(true);
    // Make the verify-job insert fail after the receipt confirmed.
    await sql.unsafe(`
      create or replace function test_fail_verify_enqueue() returns trigger
      language plpgsql as $$ begin raise exception 'outbox unavailable'; end $$;
      create trigger test_fail_verify_enqueue before insert on outbox_events
      for each row when (new.event_type = 'VERIFY_DEVICE_EVENT')
      execute function test_fail_verify_enqueue();
    `);
    try {
      await expect(
        publishDeviceEvent({
          db,
          deviceEventId: event.id,
          recorderOverride: makeFakeRecorder(),
        }),
      ).rejects.toThrow();
    } finally {
      await sql.unsafe(`
        drop trigger if exists test_fail_verify_enqueue on outbox_events;
        drop function if exists test_fail_verify_enqueue();
      `);
    }
    const [afterFailure] = await eventsFor(event.deviceId);
    expect(afterFailure).toMatchObject({
      status: 'pending',
      confirmedAt: null,
    });
    expect(afterFailure?.transactionHash).not.toBeNull();

    const result = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: makeFakeRecorder({
        reconcile: async () => ({ outcome: 'confirmed', blockNumber: 789n }),
      }),
    });
    expect(result.status).toBe('confirmed');
    const jobs = await db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, 'VERIFY_DEVICE_EVENT'),
          eq(outboxEvents.aggregateId, event.id),
        ),
      );
    expect(jobs).toHaveLength(1);
  });

  it('never marks confirmed while the in-flight tx is unconfirmed', async () => {
    const { event } = await queuedEventFor(true);
    const crashing = makeFakeRecorder({
      record: async (input) => {
        await input.onBroadcast(fakeTxHash());
        throw new Error('receipt timeout');
      },
    });
    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: crashing,
      }),
    ).rejects.toThrow();

    const stillPending = makeFakeRecorder();
    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: stillPending,
      }),
    ).rejects.toThrow('not confirmed yet');
    expect(stillPending.calls).toHaveLength(0);
    const [row] = await eventsFor(event.deviceId);
    expect(row?.status).toBe('pending');
  });

  it('fails an unrecognized receipt and does not send another transaction', async () => {
    const { event } = await queuedEventFor(true);
    const broadcastHash = fakeTxHash();
    const crashing = makeFakeRecorder({
      record: async (input) => {
        await input.onBroadcast(broadcastHash);
        throw new Error('receipt timeout');
      },
    });
    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: crashing,
      }),
    ).rejects.toThrow('receipt timeout');

    const unrecognized = makeFakeRecorder({
      reconcile: async () => ({ outcome: 'unrecognized' }),
    });
    const result = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: unrecognized,
    });
    expect(result).toEqual({ status: 'unrecognized' });
    expect(unrecognized.calls).toHaveLength(0);

    const [row] = await eventsFor(event.deviceId);
    expect(row).toMatchObject({
      status: 'failed',
      transactionHash: broadcastHash,
      claimedAt: null,
    });

    const again = makeFakeRecorder();
    const second = await publishDeviceEvent({
      db,
      deviceEventId: event.id,
      recorderOverride: again,
    });
    expect(second).toEqual({ status: 'already_failed' });
    expect(again.calls).toHaveLength(0);
  });

  it('clears a reverted tx so the next attempt sends afresh', async () => {
    const { event } = await queuedEventFor(true);
    const reverting = makeFakeRecorder({
      record: async (input) => {
        const hash = fakeTxHash();
        await input.onBroadcast(hash);
        return { outcome: 'reverted', transactionHash: hash };
      },
    });
    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: reverting,
      }),
    ).rejects.toThrow('reverted');

    const [row] = await eventsFor(event.deviceId);
    expect(row).toMatchObject({ status: 'queued', transactionHash: null });
  });

  it('refuses to record against a different contract than the mint', async () => {
    const { device, event } = await queuedEventFor(true);
    await db
      .update(devices)
      .set({
        nftContractAddress: '0x0000000000000000000000000000000000000001',
      })
      .where(eq(devices.id, device.id));
    const recorder = makeFakeRecorder();

    await expect(
      publishDeviceEvent({
        db,
        deviceEventId: event.id,
        recorderOverride: recorder,
      }),
    ).rejects.toThrow('different contract');
    expect(recorder.calls).toHaveLength(0);
  });
});
