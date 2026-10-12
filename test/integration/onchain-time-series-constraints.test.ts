import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  chargingSessions,
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

const UNIQUE_VIOLATION = { code: '23505' };
const CHECK_VIOLATION = { code: '23514' };

async function insertTestDevice() {
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
    })
    .returning();
  if (device === undefined) {
    throw new Error('Failed to seed test device');
  }
  return device;
}

function eventRow(input: {
  deviceId: string;
  sourceId: string;
  sourceType?: 'charging_session' | 'daily_odometer';
  eventType?: number;
}) {
  return {
    deviceId: input.deviceId,
    eventType: input.eventType ?? 2,
    sourceType: input.sourceType ?? 'charging_session',
    sourceId: input.sourceId,
    occurredAt: new Date(),
    payloadJson: '{}',
    payloadHash: `0x${'0'.repeat(64)}`,
  };
}

/**
 * The time-series invariants live in Postgres, not only in application code:
 * these must hold even if a buggy or concurrent caller tries to break them.
 */
describe('on-chain time-series schema constraints', () => {
  it('allows only one active charging session per device', async () => {
    const device = await insertTestDevice();
    await db.insert(chargingSessions).values({
      deviceId: device.id,
      sessionId: randomUUID(),
      startTime: new Date(),
    });

    await expect(
      db.insert(chargingSessions).values({
        deviceId: device.id,
        sessionId: randomUUID(),
        startTime: new Date(),
      }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it('rejects a completed session without an end time', async () => {
    const device = await insertTestDevice();
    await expect(
      db.insert(chargingSessions).values({
        deviceId: device.id,
        sessionId: randomUUID(),
        status: 'completed',
        startTime: new Date(),
      }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('dedupes odometer readings by (device, observed_at)', async () => {
    const device = await insertTestDevice();
    const observedAt = new Date('2026-10-12T08:00:00Z');
    await db
      .insert(odometerReadings)
      .values({ deviceId: device.id, observedAt, odometerKm: '1000.000' });

    await expect(
      db
        .insert(odometerReadings)
        .values({ deviceId: device.id, observedAt, odometerKm: '1000.000' }),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it('rejects a daily odometer row that runs backwards', async () => {
    const device = await insertTestDevice();
    await expect(
      db.insert(dailyOdometer).values({
        deviceId: device.id,
        dateUtc: '2026-10-11',
        startOdometerKm: '1000.000',
        endOdometerKm: '999.000',
      }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('publishes a given source at most once', async () => {
    const device = await insertTestDevice();
    const sourceId = randomUUID();
    await db
      .insert(deviceEvents)
      .values(eventRow({ deviceId: device.id, sourceId }));

    await expect(
      db
        .insert(deviceEvents)
        .values(eventRow({ deviceId: device.id, sourceId })),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it('rejects an event type that does not match its source', async () => {
    const device = await insertTestDevice();
    await expect(
      db.insert(deviceEvents).values(
        eventRow({
          deviceId: device.id,
          sourceId: randomUUID(),
          sourceType: 'daily_odometer',
          eventType: 2,
        }),
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('cannot mark an event confirmed without a transaction', async () => {
    const device = await insertTestDevice();
    await expect(
      db.insert(deviceEvents).values({
        ...eventRow({ deviceId: device.id, sourceId: randomUUID() }),
        status: 'confirmed',
      }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});
