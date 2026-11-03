import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const UNIQUE_VIOLATION = { code: '23505' };
const CHECK_VIOLATION = { code: '23514' };

async function seedEvent() {
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
    })
    .returning();
  if (device === undefined) throw new Error('seed failed');
  const [event] = await db
    .insert(deviceEvents)
    .values({
      deviceId: device.id,
      eventType: 2,
      sourceType: 'charging_session',
      sourceId: randomUUID(),
      occurredAt: new Date(),
      payloadJson: '{}',
      payloadHash: `0x${'0'.repeat(64)}`,
    })
    .returning();
  if (event === undefined) throw new Error('seed failed');
  return { event, principal };
}

function unlock(
  deviceEventId: string,
  buyer:
    | { buyerKind: 'owner'; principalId: string }
    | { buyerKind: 'agent'; agentAddress: string }
    | { buyerKind: 'admin' },
  overrides: Partial<typeof eventUnlocks.$inferInsert> = {},
): typeof eventUnlocks.$inferInsert {
  return {
    deviceEventId,
    ...buyer,
    payerAddress: '0x00000000000000000000000000000000000000b0',
    sellerAddress: '0x1111111111111111111111111111111111111111',
    network: 'eip155:5042002',
    asset: '0x3600000000000000000000000000000000000000',
    amountAtomic: 1000n,
    settlementReference: randomUUID(),
    ...overrides,
  };
}

/** Unlock invariants hold in Postgres, whatever the application does. */
describe('event_unlocks constraints', () => {
  it('lets each buyer unlock an event once', async () => {
    const { event, principal } = await seedEvent();
    const owner = { buyerKind: 'owner' as const, principalId: principal.id };
    await db.insert(eventUnlocks).values(unlock(event.id, owner));
    await expect(
      db.insert(eventUnlocks).values(unlock(event.id, owner)),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);

    const agent = { buyerKind: 'agent' as const, agentAddress: '0xa9e47' };
    await db.insert(eventUnlocks).values(unlock(event.id, agent));
    await expect(
      db.insert(eventUnlocks).values(unlock(event.id, agent)),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);

    await db
      .insert(eventUnlocks)
      .values(unlock(event.id, { buyerKind: 'admin' }));
    await expect(
      db.insert(eventUnlocks).values(unlock(event.id, { buyerKind: 'admin' })),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it('never lets one Gateway payment back two unlocks', async () => {
    const first = await seedEvent();
    const second = await seedEvent();
    const reference = randomUUID();
    await db
      .insert(eventUnlocks)
      .values(
        unlock(
          first.event.id,
          { buyerKind: 'admin' },
          { settlementReference: reference },
        ),
      );
    await expect(
      db
        .insert(eventUnlocks)
        .values(
          unlock(
            second.event.id,
            { buyerKind: 'admin' },
            { settlementReference: reference },
          ),
        ),
    ).rejects.toMatchObject(UNIQUE_VIOLATION);
  });

  it('rejects inconsistent buyers, free unlocks and settled rows without a tx', async () => {
    const { event, principal } = await seedEvent();
    await expect(
      db.insert(eventUnlocks).values({
        ...unlock(event.id, { buyerKind: 'admin' }),
        principalId: principal.id,
      }),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      db
        .insert(eventUnlocks)
        .values(unlock(event.id, { buyerKind: 'admin' }, { amountAtomic: 0n })),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      db
        .insert(eventUnlocks)
        .values(
          unlock(
            event.id,
            { buyerKind: 'admin' },
            { settlementStatus: 'settled' },
          ),
        ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('stores addresses lowercase', async () => {
    const { event } = await seedEvent();
    await expect(
      db
        .insert(eventUnlocks)
        .values(
          unlock(
            event.id,
            { buyerKind: 'admin' },
            { payerAddress: '0xABC0000000000000000000000000000000000001' },
          ),
        ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
  });
});
