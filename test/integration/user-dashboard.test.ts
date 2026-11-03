import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { unlockWithStaticPayer } from '@/server/application/unlocks/event-unlock';
import {
  getUserOverview,
  listUnlocksForPrincipal,
  unlockedContentForPrincipal,
} from '@/server/application/unlocks/list-unlocks';
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

async function seedOwnerWithEvents(count: number) {
  const { wallet, principal } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId: randomUUID(),
      mintStatus: 'minted',
      nftTokenId: '7',
    })
    .returning();
  if (device === undefined) throw new Error('seed failed');
  const events = await db
    .insert(deviceEvents)
    .values(
      Array.from({ length: count }, (_, i) => ({
        deviceId: device.id,
        eventType: 12,
        sourceType: 'daily_odometer',
        sourceId: randomUUID(),
        occurredAt: new Date(Date.UTC(2031, 0, 1 + i)),
        payloadJson: '{}',
        payloadHash: `0x${'dd'.repeat(32)}`,
        status: 'confirmed',
        transactionHash: `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`,
        tokenId: '7',
        blockNumber: 1n,
        confirmedAt: new Date(),
        verificationStatus: i === 0 ? 'verified' : 'unchecked',
      })),
    )
    .returning();
  const owner = {
    kind: 'owner' as const,
    principalId: principal.id,
    walletId: wallet.id,
  };
  return { owner, events };
}

describe('user dashboard queries', () => {
  it('counts devices, records, unlocks and spend for the overview', async () => {
    const { owner, events } = await seedOwnerWithEvents(3);
    const payer = createMockGatewayBuyer({
      address: '0x00000000000000000000000000000000000000c1',
    });
    for (const event of events.slice(0, 2)) {
      await unlockWithStaticPayer({
        db,
        eventId: event.id,
        buyer: owner,
        resourceUrl: 'https://app.test/e',
        config,
        seller: createMockGatewaySeller(),
        payer,
      });
    }
    expect(await getUserOverview(db, owner)).toEqual({
      devices: 1,
      minted: 1,
      anchoredEvents: 3,
      verifiedEvents: 1,
      unlockedEvents: 2,
      spentAtomic: 2000n,
    });

    const content = await unlockedContentForPrincipal(
      db,
      owner.principalId,
      events.map((event) => event.id),
    );
    expect([...content.keys()].sort()).toEqual(
      events
        .slice(0, 2)
        .map((event) => event.id)
        .sort(),
    );
  });

  it('pages payments newest first without skipping same-millisecond rows', async () => {
    const { owner, events } = await seedOwnerWithEvents(3);
    for (const event of events) {
      await db.insert(eventUnlocks).values({
        deviceEventId: event.id,
        buyerKind: 'owner',
        principalId: owner.principalId,
        payerAddress: '0x00000000000000000000000000000000000000c2',
        sellerAddress: config.sellerAddress,
        network: config.network.caip2,
        asset: config.network.usdcAddress.toLowerCase(),
        amountAtomic: 1000n,
        settlementReference: randomUUID(),
        createdAt: new Date('2031-02-01T00:00:00.123Z'),
      });
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = await listUnlocksForPrincipal(db, {
        principalId: owner.principalId,
        limit: 1,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...result.unlocks.map((row) => row.unlock.deviceEventId));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(seen.sort()).toEqual(events.map((event) => event.id).sort());
  });
});
