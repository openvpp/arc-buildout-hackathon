import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  computeRecordHash,
  recomputeEventRecord,
} from '@/server/application/telemetry/device-event-record';
import { finalizeDueOdometerDays } from '@/server/application/telemetry/finalize-odometer-days';
import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import {
  deviceEvents,
  devices,
  odometerReadings,
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
  const vehicle: Record<string, unknown> = {
    id: externalDeviceId,
    location: { latitude: 59.9139, longitude: 10.7522 },
  };
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

async function eventsFor(deviceId: string) {
  return db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.deviceId, deviceId));
}

describe('recordHash commitment (payload version 2)', () => {
  it('commits a charging event to its full record without publishing it', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2031-01-01T10:00:00Z', {
      isCharging: true,
      battery: 20,
    });
    await deliver(device.externalDeviceId, '2031-01-01T11:00:00Z', {
      isCharging: false,
      battery: 70,
    });

    const [event] = await eventsFor(device.id);
    expect(event?.payloadVersion).toBe(2);
    const payload = JSON.parse(event?.payloadJson ?? '{}') as Record<
      string,
      unknown
    >;
    // recordHash is the last key and matches the stored commitment.
    expect(Object.keys(payload).at(-1)).toBe('recordHash');
    expect(payload['recordHash']).toBe(event?.recordHash);
    expect(
      computeRecordHash(event?.recordSalt ?? '', event?.recordJson ?? ''),
    ).toBe(event?.recordHash);

    // The private record holds the location; the public payload never does.
    expect(event?.recordJson).toContain('59.913900');
    expect(event?.payloadJson).not.toContain('59.91');
    expect(event?.payloadJson).not.toContain(event?.recordSalt ?? 'x');
  });

  it('keeps a daily record stable across late readings but not edits', async () => {
    const device = await seedDevice();
    await deliver(device.externalDeviceId, '2031-02-01T08:00:00Z', {
      odometerKm: 1000,
    });
    await deliver(device.externalDeviceId, '2031-02-01T18:00:00Z', {
      odometerKm: 1040,
    });
    await finalizeDueOdometerDays(db, new Date('2031-02-02T01:00:00Z'));

    const [event] = await eventsFor(device.id);
    expect(event?.payloadVersion).toBe(2);
    expect(JSON.parse(event?.recordJson ?? '{}').readings).toHaveLength(2);

    const recompute = async () => {
      const result = await recomputeEventRecord(db, {
        sourceType: event?.sourceType ?? '',
        sourceId: event?.sourceId ?? '',
        snapshotJson: event?.recordJson ?? '',
      });
      return result.status === 'ok'
        ? computeRecordHash(event?.recordSalt ?? '', result.recordJson)
        : null;
    };

    // A late raw reading for that day is not part of the published record.
    await deliver(device.externalDeviceId, '2031-02-01T20:00:00Z', {
      odometerKm: 1045,
    });
    expect(await recompute()).toBe(event?.recordHash);

    // Editing a reading the record was built from breaks the commitment.
    await db
      .update(odometerReadings)
      .set({ odometerKm: '1099.000' })
      .where(eq(odometerReadings.observedAt, new Date('2031-02-01T18:00:00Z')));
    expect(await recompute()).not.toBe(event?.recordHash);
  });

  it('rejects a version-2 row without its commitment', async () => {
    const device = await seedDevice();
    await expect(
      db.insert(deviceEvents).values({
        deviceId: device.id,
        eventType: 2,
        sourceType: 'charging_session',
        sourceId: randomUUID(),
        occurredAt: new Date(),
        payloadJson: '{}',
        payloadHash: `0x${'0'.repeat(64)}`,
        payloadVersion: 2,
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
