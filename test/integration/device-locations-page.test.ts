import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { ApplicationError } from '@/server/application/application-error';
import { listAllDeviceLocations } from '@/server/application/dashboard/list-device-locations';
import { devices } from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

describe('listAllDeviceLocations', () => {
  it('returns located devices newest-first and continues with a cursor', async () => {
    const { wallet } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const olderId = randomUUID();
    const newerId = randomUUID();
    const unlocatedId = randomUUID();
    await db.insert(devices).values([
      {
        walletId: wallet.id,
        provider: 'enode',
        externalDeviceId: olderId,
        deviceType: 'electric_vehicle',
        lastLatitude: '1.000000',
        lastLongitude: '2.000000',
        lastLocationAt: new Date('2098-01-01T00:00:00.000Z'),
      },
      {
        walletId: wallet.id,
        provider: 'enode',
        externalDeviceId: newerId,
        deviceType: 'electric_vehicle',
        lastLatitude: '3.000000',
        lastLongitude: '4.000000',
        lastLocationAt: new Date('2099-01-01T00:00:00.000Z'),
      },
      {
        walletId: wallet.id,
        provider: 'enode',
        externalDeviceId: unlocatedId,
        deviceType: 'electric_vehicle',
      },
    ]);

    const first = await listAllDeviceLocations(db, { limit: 1 });
    expect(first.locations.map((row) => row.externalDeviceId)).toEqual([
      newerId,
    ]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAllDeviceLocations(db, {
      limit: 1,
      cursor: first.nextCursor ?? '',
    });
    expect(second.locations.map((row) => row.externalDeviceId)).toEqual([
      olderId,
    ]);

    const everything = await listAllDeviceLocations(db, { limit: 200 });
    expect(
      everything.locations.some((row) => row.externalDeviceId === unlocatedId),
    ).toBe(false);
  });

  it('rejects a malformed cursor', async () => {
    await expect(
      listAllDeviceLocations(db, { cursor: '%%%' }),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
});
