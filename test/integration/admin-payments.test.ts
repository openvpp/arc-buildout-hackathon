import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  adminUnlocksByEvent,
  confirmedEventOnDevice,
  getPaymentTotals,
  listAdminPayments,
  unpaidAnchoredEventIds,
} from '@/server/application/admin/admin-payments';
import { getAdminOverview } from '@/server/application/admin/get-admin-overview';
import { unlockWithStaticPayer } from '@/server/application/unlocks/event-unlock';
import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';
import {
  createMockGatewayBuyer,
  createMockGatewaySeller,
} from '@/server/infrastructure/payments/mock-gateway';
import { resolvePaymentConfig } from '@/server/infrastructure/payments/payment-config';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const resolved = resolvePaymentConfig();
if (!resolved.ok) throw new Error('test env must configure payments');
const config = resolved.config;

async function seedDevice(events: { status: 'confirmed' | 'queued' }[]) {
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
      nftTokenId: '5',
      mintStatus: 'minted',
    })
    .returning();
  if (device === undefined) throw new Error('seed failed');
  const rows = await db
    .insert(deviceEvents)
    .values(
      events.map((event, i) => ({
        deviceId: device.id,
        eventType: 12,
        sourceType: 'daily_odometer',
        sourceId: randomUUID(),
        occurredAt: new Date(Date.UTC(2031, 5, 1 + i)),
        payloadJson: '{}',
        payloadHash: `0x${'ee'.repeat(32)}`,
        status: event.status,
        ...(event.status === 'confirmed'
          ? {
              transactionHash: `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`,
              tokenId: '5',
              blockNumber: 1n,
              confirmedAt: new Date(),
            }
          : {}),
      })),
    )
    .returning();
  return { device, events: rows };
}

describe('admin payments', () => {
  it('lists the anchored events the admin has not paid for, then marks them paid', async () => {
    const { device, events } = await seedDevice([
      { status: 'confirmed' },
      { status: 'confirmed' },
      { status: 'queued' },
    ]);
    const unpaid = await unpaidAnchoredEventIds(db, device.id, 10);
    expect(unpaid.sort()).toEqual(
      events
        .filter((e) => e.status === 'confirmed')
        .map((e) => e.id)
        .sort(),
    );

    const payer = createMockGatewayBuyer({
      address: '0x00000000000000000000000000000000000000d1',
    });
    await unlockWithStaticPayer({
      db,
      eventId: unpaid[0] ?? '',
      buyer: { kind: 'admin' },
      resourceUrl: 'https://app.test/e',
      config,
      seller: createMockGatewaySeller(),
      payer,
    });
    expect(await unpaidAnchoredEventIds(db, device.id, 10)).toHaveLength(1);
    const byEvent = await adminUnlocksByEvent(
      db,
      events.map((e) => e.id),
    );
    expect([...byEvent.keys()]).toEqual([unpaid[0]]);
    const anchored = events.find((event) => event.status === 'confirmed');
    const queued = events.find((event) => event.status === 'queued');
    if (anchored === undefined || queued === undefined) {
      throw new Error('seed failed');
    }
    expect(await confirmedEventOnDevice(db, device.id, anchored.id)).toBe(true);
    expect(await confirmedEventOnDevice(db, device.id, queued.id)).toBe(false);
    expect(await confirmedEventOnDevice(db, randomUUID(), anchored.id)).toBe(
      false,
    );
  });

  it('totals revenue, settled amounts and buyers, and lists every payment', async () => {
    const before = await getPaymentTotals(db);
    const beforeFetched = (await getAdminOverview(db)).paidFetches.events;
    const { events } = await seedDevice([
      { status: 'confirmed' },
      { status: 'confirmed' },
    ]);
    const [first, second] = events;
    if (first === undefined || second === undefined)
      throw new Error('seed failed');
    const base = {
      payerAddress: '0x00000000000000000000000000000000000000d2',
      sellerAddress: config.sellerAddress,
      network: config.network.caip2,
      asset: config.network.usdcAddress.toLowerCase(),
      amountAtomic: 1000n,
    };
    await db.insert(eventUnlocks).values([
      {
        ...base,
        deviceEventId: first.id,
        buyerKind: 'agent',
        agentAddress: '0xa9e5',
        settlementReference: randomUUID(),
      },
      {
        ...base,
        deviceEventId: second.id,
        buyerKind: 'admin',
        settlementReference: randomUUID(),
        settlementStatus: 'settled',
        settlementTxHash: `0x${'f'.repeat(64)}`,
        settledAt: new Date(),
      },
    ]);
    const after = await getPaymentTotals(db);
    const afterFetched = (await getAdminOverview(db)).paidFetches.events;
    expect(afterFetched - beforeFetched).toBe(2);
    expect(after.count - before.count).toBe(2);
    expect(after.revenueAtomic - before.revenueAtomic).toBe(2000n);
    expect(after.settledAtomic - before.settledAtomic).toBe(1000n);
    expect(after.byBuyer.agent - before.byBuyer.agent).toBe(1);

    const listed = await listAdminPayments(db, { limit: 100 });
    const ids = listed.payments.map((row) => row.unlock.deviceEventId);
    expect(ids).toEqual(expect.arrayContaining([first.id, second.id]));
  });
});
