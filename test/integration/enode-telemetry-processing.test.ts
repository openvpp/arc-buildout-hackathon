import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import {
  chargingSessions,
  dailyOdometer,
  devices,
  odometerReadings,
  webhookDeliveries,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

async function seedDevice(status: 'active' | 'disconnected' = 'active') {
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
      status,
    })
    .returning();
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return device;
}

type Telemetry = {
  at: string;
  isCharging?: boolean;
  batteryLevel?: number;
  odometerKm?: number;
};

function deliver(
  externalDeviceId: string,
  telemetry: Telemetry,
  deliveryId: string = randomUUID(),
) {
  const vehicle: Record<string, unknown> = { id: externalDeviceId };
  if (telemetry.isCharging !== undefined) {
    vehicle.chargeState = {
      isCharging: telemetry.isCharging,
      batteryLevel: telemetry.batteryLevel ?? null,
      batteryCapacity: 75,
      lastUpdated: telemetry.at,
    };
  }
  if (telemetry.odometerKm !== undefined) {
    vehicle.odometer = {
      distance: telemetry.odometerKm,
      lastUpdated: telemetry.at,
    };
  }
  return processEnodeWebhook(db, {
    rawBody: JSON.stringify([
      { event: 'user:vehicle:updated', createdAt: telemetry.at, vehicle },
    ]),
    deliveryIdHeader: deliveryId,
    signatureValid: true,
  });
}

function sessionsFor(deviceId: string) {
  return db
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.deviceId, deviceId))
    .orderBy(asc(chargingSessions.startTime));
}

function daysFor(deviceId: string) {
  return db
    .select()
    .from(dailyOdometer)
    .where(eq(dailyOdometer.deviceId, deviceId))
    .orderBy(asc(dailyOdometer.dateUtc));
}

describe('Enode telemetry → charging sessions', () => {
  it('runs a full start → update → complete lifecycle', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;

    await deliver(ext, {
      at: '2026-10-12T10:00:00Z',
      isCharging: true,
      batteryLevel: 40,
    });
    await deliver(ext, {
      at: '2026-10-12T10:30:00Z',
      isCharging: true,
      batteryLevel: 60,
    });
    await deliver(ext, {
      at: '2026-10-12T11:00:00Z',
      isCharging: false,
      batteryLevel: 80,
    });

    const sessions = await sessionsFor(device.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: `session_${device.id}_${new Date('2026-10-12T10:00:00Z').getTime()}`,
      status: 'completed',
      startBatteryLevel: '40.00',
      endBatteryLevel: '80.00',
      energyDeliveredKwh: '30.0000',
      energyMethod: 'estimated_from_battery_change',
      electricityPrice: '0.1200',
      totalCost: '3.6000',
    });
    expect(sessions[0]?.endTime).toEqual(new Date('2026-10-12T11:00:00Z'));
  });

  it('estimates energy from the peak when the closing sample falls back', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, {
      at: '2026-10-12T10:00:00Z',
      isCharging: true,
      batteryLevel: 20,
    });
    await deliver(ext, {
      at: '2026-10-12T10:30:00Z',
      isCharging: true,
      batteryLevel: 80,
    });
    await deliver(ext, {
      at: '2026-10-12T11:00:00Z',
      isCharging: false,
      batteryLevel: 20,
    });

    const [session] = await sessionsFor(device.id);
    expect(session).toMatchObject({
      status: 'completed',
      startBatteryLevel: '20.00',
      endBatteryLevel: '20.00',
      // (80 - 20)% of 75 kWh
      energyDeliveredKwh: '45.0000',
      energyMethod: 'estimated_from_battery_change',
    });
  });

  it('backfills a missing opening battery level from the first sample', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-12T10:00:00Z', isCharging: true });
    await deliver(ext, {
      at: '2026-10-12T10:20:00Z',
      isCharging: true,
      batteryLevel: 40,
    });
    await deliver(ext, {
      at: '2026-10-12T10:40:00Z',
      isCharging: true,
      batteryLevel: 80,
    });
    await deliver(ext, {
      at: '2026-10-12T11:00:00Z',
      isCharging: false,
      batteryLevel: 80,
    });

    const [session] = await sessionsFor(device.id);
    expect(session).toMatchObject({
      status: 'completed',
      startBatteryLevel: '40.00',
      endBatteryLevel: '80.00',
      // (80 - 40)% of 75 kWh
      energyDeliveredKwh: '30.0000',
      energyMethod: 'estimated_from_battery_change',
    });
  });

  it('does not reopen a session from a late, replayed charging event', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, {
      at: '2026-10-12T10:00:00Z',
      isCharging: true,
      batteryLevel: 40,
    });
    await deliver(ext, {
      at: '2026-10-12T11:00:00Z',
      isCharging: false,
      batteryLevel: 80,
    });
    // A different delivery carrying an older "still charging" state.
    await deliver(ext, {
      at: '2026-10-12T10:30:00Z',
      isCharging: true,
      batteryLevel: 60,
    });

    const sessions = await sessionsFor(device.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe('completed');
  });

  it('keeps one active session under concurrent deliveries', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        deliver(ext, {
          at: new Date(Date.UTC(2026, 9, 12, 10, i)).toISOString(),
          isCharging: true,
          batteryLevel: 40 + i,
        }),
      ),
    );

    const sessions = await sessionsFor(device.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe('active');
  });

  it('ignores telemetry for a disconnected device', async () => {
    const device = await seedDevice('disconnected');
    await deliver(device.externalDeviceId, {
      at: '2026-10-12T10:00:00Z',
      isCharging: true,
      batteryLevel: 40,
      odometerKm: 1000,
    });
    expect(await sessionsFor(device.id)).toHaveLength(0);
    expect(await daysFor(device.id)).toHaveLength(0);
  });

  it('only touches the device matching (provider, external_device_id)', async () => {
    const target = await seedDevice();
    const bystander = await seedDevice();
    await deliver(target.externalDeviceId, {
      at: '2026-10-12T10:00:00Z',
      isCharging: true,
      batteryLevel: 40,
    });
    expect(await sessionsFor(target.id)).toHaveLength(1);
    expect(await sessionsFor(bystander.id)).toHaveLength(0);
  });
});

describe('Enode telemetry → daily odometer', () => {
  it("aggregates a day and chains the next day to yesterday's end", async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;

    await deliver(ext, { at: '2026-10-11T08:00:00Z', odometerKm: 1000 });
    await deliver(ext, { at: '2026-10-11T18:00:00Z', odometerKm: 1042.5 });
    // Out-of-order older reading must not lower the end.
    await deliver(ext, { at: '2026-10-11T12:00:00Z', odometerKm: 1020 });
    await deliver(ext, { at: '2026-10-12T09:00:00Z', odometerKm: 1060 });

    const days = await daysFor(device.id);
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      dateUtc: '2026-10-11',
      startOdometerKm: '1000.000',
      endOdometerKm: '1042.500',
      startEstimated: true,
      readingCount: 3,
      status: 'open',
    });
    expect(days[1]).toMatchObject({
      dateUtc: '2026-10-12',
      startOdometerKm: '1042.500',
      endOdometerKm: '1060.000',
      startEstimated: false,
    });
  });

  it('counts a backwards reading as an anomaly without changing the day', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-12T08:00:00Z', odometerKm: 1000 });
    await deliver(ext, { at: '2026-10-12T09:00:00Z', odometerKm: 900 });

    const [day] = await daysFor(device.id);
    expect(day).toMatchObject({
      startOdometerKm: '1000.000',
      endOdometerKm: '1000.000',
      readingCount: 1,
      anomalyCount: 1,
    });
  });

  it('stores a re-sent reading once', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-12T08:00:00Z', odometerKm: 1000 });
    await deliver(ext, { at: '2026-10-12T08:00:00Z', odometerKm: 1000 });

    const readings = await db
      .select()
      .from(odometerReadings)
      .where(eq(odometerReadings.deviceId, device.id));
    expect(readings).toHaveLength(1);
    const [day] = await daysFor(device.id);
    expect(day?.readingCount).toBe(1);
  });

  it('chains across a silent weekend to the latest prior day', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-09T18:00:00Z', odometerKm: 1000 });
    await deliver(ext, { at: '2026-10-12T08:00:00Z', odometerKm: 1400 });

    const days = await daysFor(device.id);
    expect(days).toHaveLength(2);
    expect(days[1]).toMatchObject({
      dateUtc: '2026-10-12',
      startOdometerKm: '1000.000',
      endOdometerKm: '1400.000',
      startEstimated: false,
    });
  });

  it('rebuilds the first day when an earlier lower reading arrives late', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-12T18:00:00Z', odometerKm: 1100 });
    await deliver(ext, { at: '2026-10-12T08:00:00Z', odometerKm: 1000 });

    const [day] = await daysFor(device.id);
    expect(day).toMatchObject({
      startOdometerKm: '1000.000',
      endOdometerKm: '1100.000',
      startEstimated: true,
      readingCount: 2,
      anomalyCount: 0,
    });
  });

  it('does not change a finalized day', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-11T08:00:00Z', odometerKm: 1000 });
    await db
      .update(dailyOdometer)
      .set({ status: 'finalized', finalizedAt: new Date() })
      .where(eq(dailyOdometer.deviceId, device.id));

    await deliver(ext, { at: '2026-10-11T20:00:00Z', odometerKm: 1100 });

    const [day] = await daysFor(device.id);
    expect(day?.endOdometerKm).toBe('1000.000');
  });
});

describe('device last seen', () => {
  it('advances on telemetry-only events and never moves backwards', async () => {
    const device = await seedDevice();
    const ext = device.externalDeviceId;
    await deliver(ext, { at: '2026-10-12T10:00:00Z', odometerKm: 1000 });
    await deliver(ext, {
      at: '2026-10-12T12:00:00Z',
      isCharging: true,
      batteryLevel: 50,
    });
    // An older delivery arriving late.
    await deliver(ext, { at: '2026-10-12T09:00:00Z', odometerKm: 999 });

    const [row] = await db
      .select({ lastSeenAt: devices.lastSeenAt })
      .from(devices)
      .where(eq(devices.id, device.id));
    expect(row?.lastSeenAt).toEqual(new Date('2026-10-12T12:00:00Z'));
  });
});

describe('webhook delivery retry', () => {
  it('reprocesses a delivery that previously failed', async () => {
    const device = await seedDevice();
    const deliveryId = randomUUID();
    await db.insert(webhookDeliveries).values({
      provider: 'enode',
      deliveryId,
      rawBody: '[]',
      status: 'failed',
      error: { message: 'simulated' },
    });

    const result = await deliver(
      device.externalDeviceId,
      { at: '2026-10-12T08:00:00Z', odometerKm: 1000 },
      deliveryId,
    );
    expect(result).toEqual({ status: 'processed', eventsHandled: 1 });
    expect(await daysFor(device.id)).toHaveLength(1);

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.provider, 'enode'),
          eq(webhookDeliveries.deliveryId, deliveryId),
        ),
      );
    expect(delivery?.status).toBe('processed');
  });

  it('still dedupes a delivery that was processed', async () => {
    const device = await seedDevice();
    const deliveryId = randomUUID();
    const telemetry = { at: '2026-10-12T08:00:00Z', odometerKm: 1000 };
    await deliver(device.externalDeviceId, telemetry, deliveryId);
    const second = await deliver(
      device.externalDeviceId,
      telemetry,
      deliveryId,
    );
    expect(second).toEqual({ status: 'duplicate' });
  });
});
