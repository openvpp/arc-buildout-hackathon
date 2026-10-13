import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
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
    const seeded = await db
      .select({ id: devices.id, externalDeviceId: devices.externalDeviceId })
      .from(devices);
    const byExternal = (externalId: string) =>
      seeded.find((row) => row.externalDeviceId === externalId);
    const older = byExternal(olderId);
    const newer = byExternal(newerId);
    const unlocated = byExternal(unlocatedId);

    const first = await listAllDeviceLocations(db, { limit: 1 });
    expect(first.locations.map((row) => row.id)).toEqual([newer?.id]);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAllDeviceLocations(db, {
      limit: 1,
      cursor: first.nextCursor ?? '',
    });
    expect(second.locations.map((row) => row.id)).toEqual([older?.id]);

    const everything = await listAllDeviceLocations(db, { limit: 200 });
    expect(everything.locations.some((row) => row.id === unlocated?.id)).toBe(
      false,
    );
    // The provider's vehicle id is never exposed publicly.
    expect(JSON.stringify(everything)).not.toContain(newerId);
  });

  it('shows a legacy Arc mint as minted without changing the mint column', async () => {
    const { wallet } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const externalDeviceId = randomUUID();
    await db.insert(devices).values({
      walletId: wallet.id,
      provider: 'smartcar',
      externalDeviceId,
      deviceType: 'electric_vehicle',
      mintStatus: 'unminted',
      metadata: { legacyArcMintStatus: 'minted', legacyArcNftTokenId: '50' },
      lastLatitude: '10.000000',
      lastLongitude: '20.000000',
      lastLocationAt: new Date('2000-01-01T00:00:00.000Z'),
    });
    const [device] = await db
      .select({ id: devices.id, mintStatus: devices.mintStatus })
      .from(devices)
      .where(eq(devices.externalDeviceId, externalDeviceId));

    const page = await listAllDeviceLocations(db, { limit: 200 });
    const pin = page.locations.find((row) => row.id === device?.id);
    expect(pin?.mintStatus).toBe('minted');
    expect(device?.mintStatus).toBe('unminted');
    expect(JSON.stringify(pin)).not.toContain('50');
  });

  it('rejects a malformed cursor', async () => {
    await expect(
      listAllDeviceLocations(db, { cursor: '%%%' }),
    ).rejects.toBeInstanceOf(ApplicationError);
  });
});
