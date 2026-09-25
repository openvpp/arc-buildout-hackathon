import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { devices } from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

/**
 * Mirrors the upsert finalize-pending relies on: re-linking the same
 * physical vehicle (same provider + external_device_id) must update the
 * existing row, never create a second one — including when the relink
 * comes from a different wallet (ownership transfer), and including under
 * concurrent finalize calls.
 */
describe('devices (provider, external_device_id) dedup', () => {
  it('upserts instead of duplicating on relink', async () => {
    const { wallet: walletA } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const externalDeviceId = randomUUID();

    const [created] = await db
      .insert(devices)
      .values({
        walletId: walletA.id,
        provider: 'enode',
        externalDeviceId,
        displayName: 'First link',
      })
      .onConflictDoUpdate({
        target: [devices.provider, devices.externalDeviceId],
        set: { displayName: 'First link', updatedAt: new Date() },
      })
      .returning();
    expect(created?.displayName).toBe('First link');

    const { wallet: walletB } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const [relinked] = await db
      .insert(devices)
      .values({
        walletId: walletB.id,
        provider: 'enode',
        externalDeviceId,
        displayName: 'Relinked',
      })
      .onConflictDoUpdate({
        target: [devices.provider, devices.externalDeviceId],
        set: {
          walletId: walletB.id,
          displayName: 'Relinked',
          updatedAt: new Date(),
        },
      })
      .returning();
    expect(relinked?.id).toBe(created?.id);
    expect(relinked?.walletId).toBe(walletB.id);

    const rows = await db
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.provider, 'enode'),
          eq(devices.externalDeviceId, externalDeviceId),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it('rejects a duplicate (provider, external_device_id) via a raw insert that skips the upsert path', async () => {
    const { wallet } = await insertTestWallet(db, {
      address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
      circleWalletId: randomUUID(),
    });
    const externalDeviceId = randomUUID();
    await db
      .insert(devices)
      .values({ walletId: wallet.id, provider: 'enode', externalDeviceId });

    await expect(
      db
        .insert(devices)
        .values({ walletId: wallet.id, provider: 'enode', externalDeviceId }),
    ).rejects.toThrow();
  });
});
