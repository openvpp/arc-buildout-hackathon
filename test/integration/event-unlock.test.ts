import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { ApplicationError } from '@/server/application/application-error';
import {
  buildChargingSessionRecord,
  computeRecordHash,
  newRecordSalt,
} from '@/server/application/telemetry/device-event-record';
import {
  requestEventUnlock,
  unlockWithStaticPayer,
} from '@/server/application/unlocks/event-unlock';
import {
  chargingSessions,
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';
import type {
  GatewayBuyer,
  GatewaySeller,
} from '@/server/infrastructure/payments/gateway';
import {
  createMockGatewayBuyer,
  createMockGatewaySeller,
} from '@/server/infrastructure/payments/mock-gateway';
import { resolvePaymentConfig } from '@/server/infrastructure/payments/payment-config';
import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@/server/infrastructure/payments/x402';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const resolved = resolvePaymentConfig();
if (!resolved.ok) throw new Error('test env must configure payments');
const config = resolved.config;
const RESOURCE = 'https://app.test/api/v1/agent/events/unlock';

/** Counts settle calls, delegating to the mock. Verify is passed through. */
function countingSeller(inner: GatewaySeller = createMockGatewaySeller()) {
  const counter = { calls: 0 };
  const seller: GatewaySeller = {
    async verify(args) {
      return inner.verify(args);
    },
    async settle(args) {
      counter.calls += 1;
      return inner.settle(args);
    },
  };
  return { seller, counter };
}

async function seedEvent(
  options: { status?: 'confirmed' | 'queued'; payloadVersion?: 1 | 2 } = {},
) {
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
      nftTokenId: '82',
    })
    .returning();
  if (device === undefined) throw new Error('seed failed');
  const [session] = await db
    .insert(chargingSessions)
    .values({
      deviceId: device.id,
      sessionId: randomUUID(),
      status: 'completed',
      startTime: new Date('2031-03-01T10:00:00Z'),
      endTime: new Date('2031-03-01T11:00:00Z'),
      energyDeliveredKwh: '30.0000',
      latitude: '59.910000',
      longitude: '10.750000',
    })
    .returning();
  if (session === undefined) throw new Error('seed failed');
  const recordJson = buildChargingSessionRecord(session);
  const salt = newRecordSalt();
  const v2 = (options.payloadVersion ?? 2) === 2;
  const confirmed = (options.status ?? 'confirmed') === 'confirmed';
  const [event] = await db
    .insert(deviceEvents)
    .values({
      deviceId: device.id,
      eventType: 2,
      sourceType: 'charging_session',
      sourceId: session.id,
      occurredAt: new Date('2031-03-01T11:00:00Z'),
      payloadJson: '{"vehicleId":"v","energyDelivered":30}',
      payloadHash: `0x${'cc'.repeat(32)}`,
      payloadVersion: v2 ? 2 : 1,
      recordJson: v2 ? recordJson : null,
      recordSalt: v2 ? salt : null,
      recordHash: v2 ? computeRecordHash(salt, recordJson) : null,
      status: confirmed ? 'confirmed' : 'queued',
      ...(confirmed
        ? {
            transactionHash: `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`,
            tokenId: '82',
            blockNumber: 1000n,
            confirmedAt: new Date(),
          }
        : {}),
    })
    .returning();
  if (event === undefined) throw new Error('seed failed');
  return {
    event,
    owner: {
      kind: 'owner' as const,
      principalId: principal.id,
      walletId: wallet.id,
    },
  };
}

async function unlocksFor(eventId: string) {
  return db
    .select()
    .from(eventUnlocks)
    .where(eq(eventUnlocks.deviceEventId, eventId));
}

describe('requestEventUnlock (x402)', () => {
  it('quotes a 402 Gateway payment for a locked event', async () => {
    const { event } = await seedEvent();
    const result = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
    });
    expect(result.kind).toBe('payment_required');
    if (result.kind !== 'payment_required') return;
    expect(result.priceAtomic).toBe(1000n);
    const decoded = decodePaymentRequiredHeader(result.paymentRequiredHeader);
    expect(decoded?.accepts[0]).toMatchObject({
      network: 'eip155:5042002',
      amount: '1000',
      payTo: config.sellerAddress,
    });
    expect(await unlocksFor(event.id)).toHaveLength(0);
  });

  it('unlocks for an agent once, without location or salt, and never charges twice', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e1',
    });
    const { seller, counter } = countingSeller();
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller,
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');

    const pay = async () =>
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: await agent.createPaymentSignatureHeader(
          quote.paymentRequired,
        ),
        resourceUrl: RESOURCE,
        config,
        seller,
      });
    const first = await pay();
    expect(first).toMatchObject({ kind: 'unlocked', alreadyUnlocked: false });
    if (first.kind !== 'unlocked') return;
    const record = JSON.parse(first.content.record?.json ?? '{}') as Record<
      string,
      unknown
    >;
    expect(record['energyDeliveredKwh']).toBe('30.0000');
    expect(record).not.toHaveProperty('latitude');
    expect(record).not.toHaveProperty('longitude');
    expect(first.content.record).toMatchObject({
      committed: true,
      salt: null,
      redactedFields: ['latitude', 'longitude'],
    });
    expect(first.unlock).toMatchObject({
      buyerKind: 'agent',
      agentAddress: agent.address,
      payerAddress: agent.address,
      amountAtomic: 1000n,
      settlementStatus: 'accepted',
    });

    // A new signature from the same agent: returned, not settled again.
    const again = await pay();
    expect(again).toMatchObject({ kind: 'unlocked', alreadyUnlocked: true });
    expect(counter.calls).toBe(1);
    expect(await unlocksFor(event.id)).toHaveLength(1);
  });

  it('refuses a repeat fetch that only names the payer, and verifies a real one', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e8',
    });
    const { seller, counter } = countingSeller();
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller,
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');
    const first = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: await agent.createPaymentSignatureHeader(
        quote.paymentRequired,
      ),
      resourceUrl: RESOURCE,
      config,
      seller,
    });
    expect(first).toMatchObject({ kind: 'unlocked', alreadyUnlocked: false });

    const forged = encodePaymentSignatureHeader({
      x402Version: 2,
      payload: { authorization: { from: agent.address } },
    });
    await expect(
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: forged,
        resourceUrl: RESOURCE,
        config,
        seller,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_INVALID' });
    expect(counter.calls).toBe(1);

    const again = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: await agent.createPaymentSignatureHeader(
        quote.paymentRequired,
      ),
      resourceUrl: RESOURCE,
      config,
      seller,
    });
    expect(again).toMatchObject({ kind: 'unlocked', alreadyUnlocked: true });
    expect(counter.calls).toBe(1);
    expect(await unlocksFor(event.id)).toHaveLength(1);
  });

  it('reveals nothing when a repeat fetch cannot be verified', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e9',
    });
    const mock = createMockGatewaySeller();
    const seller: GatewaySeller = {
      verify: async () => ({
        ok: false,
        code: 'unavailable',
        reason: 'timeout',
      }),
      settle: (args) => mock.settle(args),
    };
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller: mock,
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');
    const header = await agent.createPaymentSignatureHeader(
      quote.paymentRequired,
    );
    const first = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: header,
      resourceUrl: RESOURCE,
      config,
      seller: mock,
    });
    expect(first).toMatchObject({ kind: 'unlocked', alreadyUnlocked: false });
    await expect(
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: await agent.createPaymentSignatureHeader(
          quote.paymentRequired,
        ),
        resourceUrl: RESOURCE,
        config,
        seller,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
    expect(await unlocksFor(event.id)).toHaveLength(1);
  });

  it('settles once when the same agent pays twice at the same time', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e2',
    });
    const slow = createMockGatewaySeller();
    const { seller, counter } = countingSeller({
      ...slow,
      async settle(args) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return slow.settle(args);
      },
    });
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller,
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');
    const results = await Promise.all(
      [1, 2].map(async () =>
        requestEventUnlock({
          db,
          eventId: event.id,
          buyer: { kind: 'agent' },
          paymentSignatureHeader: await agent.createPaymentSignatureHeader(
            quote.paymentRequired,
          ),
          resourceUrl: RESOURCE,
          config,
          seller,
        }),
      ),
    );
    expect(counter.calls).toBe(1);
    expect(
      results.map((r) => r.kind === 'unlocked' && r.alreadyUnlocked).sort(),
    ).toEqual([false, true]);
    expect(await unlocksFor(event.id)).toHaveLength(1);
  });

  it('reveals nothing when Gateway refuses or is down', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer();
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');
    const header = await agent.createPaymentSignatureHeader(
      quote.paymentRequired,
    );
    for (const [result, code] of [
      [
        { success: false, code: 'invalid', reason: 'insufficient_balance' },
        'PAYMENT_INVALID',
      ],
      [
        { success: false, code: 'unavailable', reason: 'timeout' },
        'PAYMENT_UNAVAILABLE',
      ],
    ] as const) {
      await expect(
        requestEventUnlock({
          db,
          eventId: event.id,
          buyer: { kind: 'agent' },
          paymentSignatureHeader: header,
          resourceUrl: RESOURCE,
          config,
          seller: createMockGatewaySeller({ result }),
        }),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: 'not-a-payment',
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller(),
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_INVALID' });
    expect(await unlocksFor(event.id)).toHaveLength(0);
  });

  it('never reveals on a Gateway transfer that already backs another unlock', async () => {
    const first = await seedEvent();
    const second = await seedEvent();
    const replayed = createMockGatewaySeller({
      result: {
        success: true,
        reference: randomUUID(),
        payer: '0x000000000000000000000000000000000000a9e3',
        network: 'eip155:5042002',
      },
    });
    const agentA = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e3',
    });
    const agentB = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e4',
    });
    const unlockWith = async (
      eventId: string,
      agent: ReturnType<typeof createMockGatewayBuyer>,
    ) => {
      const quote = await requestEventUnlock({
        db,
        eventId,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: null,
        resourceUrl: RESOURCE,
        config,
        seller: replayed,
      });
      if (quote.kind !== 'payment_required')
        throw new Error('expected a quote');
      return requestEventUnlock({
        db,
        eventId,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: await agent.createPaymentSignatureHeader(
          quote.paymentRequired,
        ),
        resourceUrl: RESOURCE,
        config,
        seller: replayed,
      });
    };
    await unlockWith(first.event.id, agentA);
    await expect(unlockWith(second.event.id, agentB)).rejects.toMatchObject({
      code: 'PAYMENT_INVALID',
    });
    expect(await unlocksFor(second.event.id)).toHaveLength(0);
  });

  it('passes on only short Gateway reason codes', async () => {
    const { event } = await seedEvent();
    const agent = createMockGatewayBuyer();
    const quote = await requestEventUnlock({
      db,
      eventId: event.id,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: null,
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
    });
    if (quote.kind !== 'payment_required') throw new Error('expected a quote');
    const header = await agent.createPaymentSignatureHeader(
      quote.paymentRequired,
    );
    const refuse = (reason: string) =>
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: header,
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller({
          result: { success: false, code: 'invalid', reason },
        }),
      });
    await expect(refuse('insufficient_balance')).rejects.toThrow(
      '(insufficient_balance)',
    );
    await expect(refuse('<html>upstream 500 body</html>')).rejects.toThrow(
      'The payment was refused. Nothing was charged.',
    );
  });

  it('refuses events that are not anchored yet', async () => {
    const { event } = await seedEvent({ status: 'queued' });
    await expect(
      requestEventUnlock({
        db,
        eventId: event.id,
        buyer: { kind: 'agent' },
        paymentSignatureHeader: null,
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller(),
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_UNLOCKABLE' });
  });
});

describe('unlockWithStaticPayer (dashboard / admin)', () => {
  const payer = createMockGatewayBuyer({
    address: '0x00000000000000000000000000000000000000b1',
  });

  it('lets the owner unlock their own event: full record and salt', async () => {
    const { event, owner } = await seedEvent();
    const result = await unlockWithStaticPayer({
      db,
      eventId: event.id,
      buyer: owner,
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
      payer,
    });
    expect(result).toMatchObject({ kind: 'unlocked', alreadyUnlocked: false });
    if (result.kind !== 'unlocked') return;
    const record = JSON.parse(result.content.record?.json ?? '{}') as Record<
      string,
      unknown
    >;
    expect(record['latitude']).toBe('59.910000');
    expect(result.content.record?.salt).toBe(event.recordSalt);
    // The salt reproduces the on-chain commitment.
    expect(
      computeRecordHash(
        event.recordSalt ?? '',
        result.content.record?.json ?? '',
      ),
    ).toBe(event.recordHash);
    expect(result.unlock).toMatchObject({
      buyerKind: 'owner',
      principalId: owner.principalId,
      payerAddress: payer.address,
    });
  });

  it("hides another user's event and needs a configured payer", async () => {
    const { event } = await seedEvent();
    const stranger = await seedEvent();
    await expect(
      unlockWithStaticPayer({
        db,
        eventId: event.id,
        buyer: stranger.owner,
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller(),
        payer,
      }),
    ).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND' });
    await expect(
      unlockWithStaticPayer({
        db,
        eventId: event.id,
        buyer: { kind: 'admin' },
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller(),
        payer: null,
      }),
    ).rejects.toMatchObject({ code: 'STATIC_PAYER_UNAVAILABLE' });
  });

  it('stops at the daily cap and when Gateway funds run out', async () => {
    const capped = { ...config, staticPayerDailyCapAtomic: 1000n };
    const cappedPayer = createMockGatewayBuyer({
      address: `0x${`${randomUUID()}${randomUUID()}`.replace(/-/g, '').slice(0, 40)}`,
    });
    const first = await seedEvent();
    const second = await seedEvent();
    await unlockWithStaticPayer({
      db,
      eventId: first.event.id,
      buyer: { kind: 'admin' },
      resourceUrl: RESOURCE,
      config: capped,
      seller: createMockGatewaySeller(),
      payer: cappedPayer,
    });
    await expect(
      unlockWithStaticPayer({
        db,
        eventId: second.event.id,
        buyer: { kind: 'admin' },
        resourceUrl: RESOURCE,
        config: capped,
        seller: createMockGatewaySeller(),
        payer: cappedPayer,
      }),
    ).rejects.toMatchObject({ code: 'STATIC_PAYER_CAP_REACHED' });

    await expect(
      unlockWithStaticPayer({
        db,
        eventId: second.event.id,
        buyer: { kind: 'admin' },
        resourceUrl: RESOURCE,
        config,
        seller: createMockGatewaySeller(),
        payer: createMockGatewayBuyer({ gatewayAvailableAtomic: 0n }),
      }),
    ).rejects.toMatchObject({ code: 'STATIC_PAYER_INSUFFICIENT_FUNDS' });
  });

  it('deposits wallet USDC into Gateway when Gateway cannot cover the price', async () => {
    const funded = createMockGatewayBuyer({
      gatewayAvailableAtomic: 0n,
      walletAtomic: 5_000_000n,
    });
    const deposits: bigint[] = [];
    const payer: GatewayBuyer = {
      address: funded.address,
      getBalances: () => funded.getBalances(),
      async deposit(amount) {
        deposits.push(amount);
        return funded.deposit(amount);
      },
      createPaymentSignatureHeader: (body) =>
        funded.createPaymentSignatureHeader(body),
    };
    const { event } = await seedEvent();
    const result = await unlockWithStaticPayer({
      db,
      eventId: event.id,
      buyer: { kind: 'admin' },
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
      payer,
    });
    expect(result.kind).toBe('unlocked');
    // 1 USDC top-up, not only the 0.001 price, so the next unlock is a signature.
    expect(deposits).toEqual([1_000_000n]);
    await expect(funded.getBalances()).resolves.toEqual({
      walletAtomic: 4_000_000n,
      gatewayAvailableAtomic: 1_000_000n,
    });
  });

  it("shows a v1 event's current record, marked as not committed", async () => {
    const { event, owner } = await seedEvent({ payloadVersion: 1 });
    const result = await unlockWithStaticPayer({
      db,
      eventId: event.id,
      buyer: owner,
      resourceUrl: RESOURCE,
      config,
      seller: createMockGatewaySeller(),
      payer,
    });
    if (result.kind !== 'unlocked') throw new Error('expected an unlock');
    expect(result.content.record).toMatchObject({
      committed: false,
      salt: null,
    });
    expect(result.content.payloadJson).toBe(event.payloadJson);
  });

  it('is an ApplicationError a route can map', () => {
    expect(new ApplicationError('PAYMENT_INVALID', 'x')).toBeInstanceOf(Error);
  });
});
