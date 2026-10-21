import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeStaleChargingSessions } from '@/server/application/telemetry/close-stale-charging-sessions';
import { buildDailyOdometerPayload } from '@/server/application/telemetry/device-event-payloads';
import { finalizeDueOdometerDays } from '@/server/application/telemetry/finalize-odometer-days';
import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import {
  chargingSessions,
  dailyOdometer,
  deviceEvents,
  devices,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

async function seedDevice() {
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
    throw new Error('failed to seed device');
  }
  return device;
}

function deliver(
  externalDeviceId: string,
  at: string,
  telemetry: { odometerKm?: number; isCharging?: boolean; battery?: number },
) {
  const vehicle: Record<string, unknown> = { id: externalDeviceId };
  if (telemetry.odometerKm !== undefined) {
    vehicle.odometer = { distance: telemetry.odometerKm, lastUpdated: at };
  }
  if (telemetry.isCharging !== undefined) {
    vehicle.chargeState = {
      isCharging: telemetry.isCharging,
      batteryLevel: telemetry.battery ?? null,
      batteryCapacity: 60,
      lastUpdated: at,
    };
  }
  return processEnodeWebhook(db, {
    rawBody: JSON.stringify([
      { event: 'user:vehicle:updated', createdAt: at, vehicle },
    ]),
    deliveryIdHeader: randomUUID(),
    signatureValid: true,
  });
}

function daysFor(deviceId: string) {
  return db
    .select()
    .from(dailyOdometer)
    .where(eq(dailyOdometer.deviceId, deviceId))
    .orderBy(asc(dailyOdometer.dateUtc));
}

function eventsFor(deviceId: string) {
  return db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, deviceId));
}

describe('finalizeDueOdometerDays', () => {
  it('finalizes a finished day and queues its daily event', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-01-01T08:00:00Z', {
      odometerKm: 16093.44,
    });
    await deliver(device.externalDeviceId, '2030-01-01T18:00:00Z', {
      odometerKm: 16143.94,
    });

    await finalizeDueOdometerDays(db, new Date('2030-01-02T01:00:00Z'));

    const [day] = await daysFor(device.id);
    expect(day?.status).toBe('finalized');
    const [event] = await eventsFor(device.id);
    expect(event).toMatchObject({
      eventType: 12,
      sourceType: 'daily_odometer',
      sourceId: day?.id,
      status: 'queued',
      occurredAt: new Date('2030-01-02T00:00:00Z'),
    });
    expect(JSON.parse(event?.payloadJson ?? '{}')).toMatchObject({
      vehicleId: device.id,
      tripId: `daily-${device.id}-2030-01-01`,
      startOdometer: 10000,
      endOdometer: 10031.379,
      distanceTraveled: 31.379,
    });
  });

  it('waits for the grace period and never touches the current day', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-02-01T08:00:00Z', {
      odometerKm: 100,
    });
    await deliver(device.externalDeviceId, '2030-02-01T09:00:00Z', {
      odometerKm: 150,
    });

    // 10 minutes after midnight: still within grace.
    await finalizeDueOdometerDays(db, new Date('2030-02-02T00:10:00Z'));
    expect((await daysFor(device.id))[0]?.status).toBe('open');

    // Same UTC day: never.
    await finalizeDueOdometerDays(db, new Date('2030-02-01T23:59:00Z'));
    expect((await daysFor(device.id))[0]?.status).toBe('open');

    await finalizeDueOdometerDays(db, new Date('2030-02-02T00:31:00Z'));
    expect((await daysFor(device.id))[0]?.status).toBe('finalized');
  });

  it('finalizes a parked day without publishing it', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-03-01T08:00:00Z', {
      odometerKm: 500,
    });

    await finalizeDueOdometerDays(db, new Date('2030-03-02T01:00:00Z'));

    expect((await daysFor(device.id))[0]?.status).toBe('finalized');
    expect(await eventsFor(device.id)).toHaveLength(0);
  });

  it('is idempotent across repeated and concurrent runs', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-04-01T08:00:00Z', {
      odometerKm: 0,
    });
    await deliver(device.externalDeviceId, '2030-04-01T09:00:00Z', {
      odometerKm: 42,
    });
    const now = new Date('2030-04-02T01:00:00Z');

    await Promise.all([
      finalizeDueOdometerDays(db, now),
      finalizeDueOdometerDays(db, now),
    ]);
    await finalizeDueOdometerDays(db, now);

    expect(await eventsFor(device.id)).toHaveLength(1);
  });

  it('does not let a late reading change a day the next day chained to', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-05-01T08:00:00Z', {
      odometerKm: 1000,
    });
    await deliver(device.externalDeviceId, '2030-05-02T08:00:00Z', {
      odometerKm: 1050,
    });
    // A delayed reading from late on the 1st arrives after the 2nd began.
    await deliver(device.externalDeviceId, '2030-05-01T23:00:00Z', {
      odometerKm: 1040,
    });

    const [first, second] = await daysFor(device.id);
    expect(first?.endOdometerKm).toBe('1000.000');
    expect(second?.startOdometerKm).toBe('1000.000');
  });

  it('publishes kilometres driven across a day with no readings', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-06-05T18:00:00Z', {
      odometerKm: 1000,
    });
    await deliver(device.externalDeviceId, '2030-06-08T08:00:00Z', {
      odometerKm: 1400,
    });

    await finalizeDueOdometerDays(db, new Date('2030-06-09T01:00:00Z'));

    const days = await daysFor(device.id);
    const monday = days.find((day) => day.dateUtc === '2030-06-08');
    expect(monday).toMatchObject({
      status: 'finalized',
      startOdometerKm: '1000.000',
      endOdometerKm: '1400.000',
      startEstimated: false,
    });
    const [event] = await eventsFor(device.id);
    expect(event?.payloadJson).toBe(
      buildDailyOdometerPayload(
        {
          deviceId: device.id,
          dateUtc: '2030-06-08',
          startOdometerKm: 1000,
          endOdometerKm: 1400,
          startEstimated: false,
        },
        { recordHash: event?.recordHash ?? '' },
      ),
    );
  });
});

describe('closeStaleChargingSessions', () => {
  it('closes a session Enode never reported as stopped, at its last update', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-06-01T10:00:00Z', {
      isCharging: true,
      battery: 20,
    });
    await deliver(device.externalDeviceId, '2030-06-01T11:00:00Z', {
      isCharging: true,
      battery: 70,
    });

    const result = await closeStaleChargingSessions(db, {
      now: new Date('2030-06-02T12:00:00Z'),
      electricityPricePerKwh: 0.12,
    });
    expect(result.closed).toBeGreaterThanOrEqual(1);

    const [session] = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.deviceId, device.id));
    expect(session).toMatchObject({
      status: 'completed',
      // (70 - 20)% of 60 kWh
      energyDeliveredKwh: '30.0000',
      energyMethod: 'estimated_from_battery_change',
    });
    expect(session?.endTime).toEqual(new Date('2030-06-01T11:00:00Z'));
    const [event] = await eventsFor(device.id);
    expect(event).toMatchObject({ eventType: 2, status: 'queued' });
  });

  it('leaves a session that is still reporting', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-07-01T10:00:00Z', {
      isCharging: true,
      battery: 20,
    });

    await closeStaleChargingSessions(db, {
      now: new Date('2030-07-01T20:00:00Z'),
      electricityPricePerKwh: 0.12,
    });

    const [session] = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.deviceId, device.id));
    expect(session?.status).toBe('active');
  });

  it('opens a fresh session when charging resumes after a stale close', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2030-08-01T10:00:00Z', {
      isCharging: true,
      battery: 20,
    });
    await closeStaleChargingSessions(db, {
      now: new Date('2030-08-03T00:00:00Z'),
      electricityPricePerKwh: 0.12,
    });
    await deliver(device.externalDeviceId, '2030-08-03T09:00:00Z', {
      isCharging: true,
      battery: 30,
    });

    const sessions = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.deviceId, device.id))
      .orderBy(asc(chargingSessions.startTime));
    expect(sessions.map((s) => s.status)).toEqual(['cancelled', 'active']);
  });
});
