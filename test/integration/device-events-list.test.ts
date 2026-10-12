import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { listDeviceEventsForWallet } from '@/server/application/dashboard/list-device-events';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

async function seedOwnedDevice() {
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
  return { wallet, device };
}

function chargingPayload(hour: number) {
  return JSON.stringify({
    vehicleId: 'v',
    sessionId: `s${hour}`,
    energyDelivered: 12.5,
    startTime: `2026-10-12T${String(hour).padStart(2, '0')}:00:00.000Z`,
    endTime: `2026-10-12T${String(hour).padStart(2, '0')}:30:00.000Z`,
    batteryLevel: 80,
    method: 'estimated_from_battery_change',
    pointsAwarded: 12,
    electricityPrice: 0.12,
    totalCost: 1.5,
    currency: 'USD',
  });
}

async function insertEvents(deviceId: string, count: number) {
  for (let hour = 0; hour < count; hour += 1) {
    await db.insert(deviceEvents).values({
      deviceId,
      eventType: 2,
      sourceType: 'charging_session',
      sourceId: randomUUID(),
      occurredAt: new Date(Date.UTC(2026, 9, 12, hour, 30)),
      payloadJson: chargingPayload(hour),
      payloadHash: `0x${'a'.repeat(64)}`,
    });
  }
}

describe('listDeviceEventsForWallet', () => {
  it('returns the owner’s events newest first with a parsed summary', async () => {
    const { wallet, device } = await seedOwnedDevice();
    await insertEvents(device.id, 2);

    const page = await listDeviceEventsForWallet(db, {
      deviceId: device.id,
      walletId: wallet.id,
    });

    expect(page?.events.map((e) => e.summary)).toEqual([
      expect.objectContaining({
        kind: 'charging_completed',
        startTime: '2026-10-12T01:00:00.000Z',
        energyDeliveredKwh: 12.5,
        totalCost: 1.5,
      }),
      expect.objectContaining({ startTime: '2026-10-12T00:00:00.000Z' }),
    ]);
    expect(page?.events[0]).toMatchObject({
      status: 'queued',
      transactionHash: null,
      payloadJson: chargingPayload(1),
    });
  });

  it('hides another wallet’s device', async () => {
    const { device } = await seedOwnedDevice();
    const { wallet: stranger } = await seedOwnedDevice();
    await insertEvents(device.id, 1);

    expect(
      await listDeviceEventsForWallet(db, {
        deviceId: device.id,
        walletId: stranger.id,
      }),
    ).toBeNull();
  });

  it('pages through every event exactly once', async () => {
    const { wallet, device } = await seedOwnedDevice();
    await insertEvents(device.id, 5);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const page = await listDeviceEventsForWallet(db, {
        deviceId: device.id,
        walletId: wallet.id,
        limit: 2,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      seen.push(...(page?.events.map((e) => e.id) ?? []));
      if (page?.nextCursor === null || page === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it('rejects a malformed cursor', async () => {
    const { wallet, device } = await seedOwnedDevice();
    await expect(
      listDeviceEventsForWallet(db, {
        deviceId: device.id,
        walletId: wallet.id,
        cursor: 'not-a-cursor',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
});
