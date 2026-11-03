import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { reconcileAcceptedUnlocks } from '@/server/application/unlocks/reconcile-settlements';
import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';
import type { GatewayTransfer } from '@/server/infrastructure/payments/gateway-transfers';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const TX = `0x${'cd'.repeat(32)}`;
const LONG_AGO = new Date(Date.now() - 10 * 60_000);

async function seedUnlock(updatedAt: Date = LONG_AGO) {
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
  const [event] = await db
    .insert(deviceEvents)
    .values({
      deviceId: device!.id,
      eventType: 12,
      sourceType: 'daily_odometer',
      sourceId: randomUUID(),
      occurredAt: new Date(),
      payloadJson: '{}',
      payloadHash: `0x${'0'.repeat(64)}`,
    })
    .returning();
  const [unlock] = await db
    .insert(eventUnlocks)
    .values({
      deviceEventId: event!.id,
      buyerKind: 'admin',
      payerAddress: '0x00000000000000000000000000000000000000e1',
      sellerAddress: '0x1111111111111111111111111111111111111111',
      network: 'eip155:5042002',
      asset: '0x3600000000000000000000000000000000000000',
      amountAtomic: 1000n,
      settlementReference: randomUUID(),
      createdAt: LONG_AGO,
      updatedAt,
    })
    .returning();
  return unlock!;
}

async function reload(id: string) {
  const [row] = await db
    .select()
    .from(eventUnlocks)
    .where(eq(eventUnlocks.id, id));
  return row!;
}

describe('reconcileAcceptedUnlocks', () => {
  it('settles with the batch tx, fails on Gateway failure, waits otherwise', async () => {
    const settled = await seedUnlock();
    const failed = await seedUnlock();
    const batching = await seedUnlock();
    const transfers = new Map<string, GatewayTransfer>([
      [settled.settlementReference, { status: 'completed', txHash: TX }],
      [failed.settlementReference, { status: 'failed', txHash: null }],
      [batching.settlementReference, { status: 'batched', txHash: null }],
    ]);
    await reconcileAcceptedUnlocks({
      db,
      lookup: async (id) => transfers.get(id) ?? null,
      limit: 1000,
    });
    expect(await reload(settled.id)).toMatchObject({
      settlementStatus: 'settled',
      settlementTxHash: TX,
    });
    expect((await reload(settled.id)).settledAt).not.toBeNull();
    expect((await reload(failed.id)).settlementStatus).toBe('failed');
    const waiting = await reload(batching.id);
    expect(waiting.settlementStatus).toBe('accepted');
    // Marked as just checked, so it is not polled again right away.
    expect(waiting.updatedAt.getTime()).toBeGreaterThan(LONG_AGO.getTime());
  });

  it('skips recently checked payments and keeps them on lookup errors', async () => {
    const fresh = await seedUnlock(new Date());
    const flaky = await seedUnlock();
    const looked: string[] = [];
    const result = await reconcileAcceptedUnlocks({
      db,
      lookup: async (id) => {
        looked.push(id);
        if (id === flaky.settlementReference) throw new Error('timeout');
        return null;
      },
      limit: 1000,
    });
    expect(looked).not.toContain(fresh.settlementReference);
    expect(result.unavailable).toBeGreaterThanOrEqual(1);
    expect((await reload(flaky.id)).settlementStatus).toBe('accepted');
  });

  it('never rewrites a payment that is no longer accepted', async () => {
    const unlock = await seedUnlock();
    await db
      .update(eventUnlocks)
      .set({
        settlementStatus: 'settled',
        settlementTxHash: TX,
        settledAt: new Date(),
      })
      .where(eq(eventUnlocks.id, unlock.id));
    await reconcileAcceptedUnlocks({
      db,
      lookup: async () => ({ status: 'failed', txHash: null }),
      limit: 1000,
    });
    expect((await reload(unlock.id)).settlementStatus).toBe('settled');
  });
});
