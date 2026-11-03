import { and, eq, gte, sql, sum } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  buildUnlockedContent,
  type UnlockedContent,
} from '@/server/application/unlocks/unlock-content';
import type {
  Database,
  DatabaseExecutor,
} from '@/server/infrastructure/db/client';
import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import type {
  GatewayBuyer,
  GatewaySeller,
} from '@/server/infrastructure/payments/gateway';
import type { PaymentConfig } from '@/server/infrastructure/payments/payment-config';
import {
  buildPaymentRequired,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  findGatewayRequirements,
  signerOfPaymentSignature,
  type PaymentRequiredBody,
} from '@/server/infrastructure/payments/x402';

const log = createServerLogger({ component: 'event-unlock' });

type DeviceEventRow = typeof deviceEvents.$inferSelect;
export type EventUnlockRow = typeof eventUnlocks.$inferSelect;

/**
 * Who is unlocking. An owner is a signed-in user (their session's wallet
 * must own the device); the admin is the console; an agent is identified
 * only by the address that signs its payment.
 */
export type UnlockBuyer =
  | { kind: 'owner'; principalId: string; walletId: string }
  | { kind: 'admin' }
  | { kind: 'agent' };

export type EventUnlockResult =
  | {
      kind: 'unlocked';
      /** True when this buyer had already paid: nothing was charged now. */
      alreadyUnlocked: boolean;
      unlock: EventUnlockRow;
      event: DeviceEventRow;
      content: UnlockedContent;
    }
  | {
      kind: 'payment_required';
      paymentRequired: PaymentRequiredBody;
      /** Base64 PAYMENT-REQUIRED header value. */
      paymentRequiredHeader: string;
      priceAtomic: bigint;
      event: DeviceEventRow;
    };

/** The event, if this buyer may unlock it (else a 404/409 error). */
async function loadUnlockableEvent(
  db: DatabaseExecutor,
  eventId: string,
  buyer: UnlockBuyer,
): Promise<DeviceEventRow> {
  const [row] = await db
    .select({ event: deviceEvents, walletId: devices.walletId })
    .from(deviceEvents)
    .innerJoin(devices, eq(devices.id, deviceEvents.deviceId))
    .where(eq(deviceEvents.id, eventId))
    .limit(1);
  // An owner asking for someone else's event sees "not found", so
  // ownership isn't leaked.
  if (
    row === undefined ||
    (buyer.kind === 'owner' && row.walletId !== buyer.walletId)
  ) {
    throw new ApplicationError('EVENT_NOT_FOUND', 'Event not found.');
  }
  // Only anchored records are sold: "verified device data" needs an anchor.
  if (row.event.status !== 'confirmed') {
    throw new ApplicationError(
      'EVENT_NOT_UNLOCKABLE',
      'This event is not anchored on-chain yet, so it cannot be unlocked.',
    );
  }
  return row.event;
}

function buyerCondition(buyer: UnlockBuyer, agentAddress: string | null) {
  switch (buyer.kind) {
    case 'owner':
      return and(
        eq(eventUnlocks.buyerKind, 'owner'),
        eq(eventUnlocks.principalId, buyer.principalId),
      );
    case 'admin':
      return eq(eventUnlocks.buyerKind, 'admin');
    case 'agent':
      return agentAddress === null
        ? undefined
        : and(
            eq(eventUnlocks.buyerKind, 'agent'),
            eq(eventUnlocks.agentAddress, agentAddress),
          );
  }
}

async function findUnlock(
  db: DatabaseExecutor,
  eventId: string,
  buyer: UnlockBuyer,
  agentAddress: string | null,
): Promise<EventUnlockRow | null> {
  const condition = buyerCondition(buyer, agentAddress);
  if (condition === undefined) {
    return null;
  }
  const [row] = await db
    .select()
    .from(eventUnlocks)
    .where(and(eq(eventUnlocks.deviceEventId, eventId), condition))
    .limit(1);
  return row ?? null;
}

/** Serializes unlocks of one event by one buyer for this transaction. */
async function lockBuyerEvent(
  tx: DatabaseExecutor,
  eventId: string,
  buyerKey: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`unlock:${eventId}:${buyerKey}`}, 0))`,
  );
}

function buyerKeyOf(buyer: UnlockBuyer, agentAddress: string | null): string {
  return buyer.kind === 'owner'
    ? `owner:${buyer.principalId}`
    : buyer.kind === 'admin'
      ? 'admin'
      : `agent:${agentAddress ?? 'unknown'}`;
}

function paymentRequiredFor(
  config: PaymentConfig,
  event: DeviceEventRow,
  resourceUrl: string,
): PaymentRequiredBody {
  return buildPaymentRequired({
    network: config.network,
    payTo: config.sellerAddress,
    amountAtomic: config.unlockPriceAtomic,
    resourceUrl,
    description: `Unlock verified device event ${event.id}`,
  });
}

async function unlockedResult(
  db: DatabaseExecutor,
  event: DeviceEventRow,
  unlock: EventUnlockRow,
  alreadyUnlocked: boolean,
): Promise<EventUnlockResult> {
  return {
    kind: 'unlocked',
    alreadyUnlocked,
    unlock,
    event,
    content: await buildUnlockedContent(
      db,
      event,
      unlock.buyerKind === 'agent'
        ? 'agent'
        : unlock.buyerKind === 'admin'
          ? 'admin'
          : 'owner',
    ),
  };
}

/**
 * The x402 unlock flow for one event, settle-before-reveal:
 * - already unlocked by this buyer → the content, nothing charged;
 * - no payment → `payment_required` (402 with the Gateway requirement);
 * - a payment → Circle Gateway settles it, then the unlock is recorded and
 *   the content returned. A refused payment reveals nothing.
 * Runs in one transaction holding a per-(event, buyer) lock, so two
 * concurrent requests never charge the same buyer twice.
 */
export async function requestEventUnlock(input: {
  db: Database;
  eventId: string;
  buyer: UnlockBuyer;
  paymentSignatureHeader: string | null;
  resourceUrl: string;
  config: PaymentConfig;
  seller: GatewaySeller;
  /**
   * The static payer's daily cap, enforced inside this transaction under a
   * per-payer lock so concurrent unlocks cannot overshoot it.
   */
  staticPayerCap?: { payerAddress: string; capAtomic: bigint; now?: Date };
}): Promise<EventUnlockResult> {
  const signature =
    input.paymentSignatureHeader === null
      ? null
      : decodePaymentSignatureHeader(input.paymentSignatureHeader);
  if (input.paymentSignatureHeader !== null && signature === null) {
    throw new ApplicationError(
      'PAYMENT_INVALID',
      'The PAYMENT-SIGNATURE header is not an x402 payment.',
    );
  }
  // An agent is the address that signs; known before settling.
  const agentAddress =
    input.buyer.kind === 'agent' && signature !== null
      ? signerOfPaymentSignature(signature)
      : null;
  if (
    input.buyer.kind === 'agent' &&
    signature !== null &&
    agentAddress === null
  ) {
    throw new ApplicationError(
      'PAYMENT_INVALID',
      'The payment carries no signer address.',
    );
  }

  return input.db.transaction(async (tx) => {
    const event = await loadUnlockableEvent(tx, input.eventId, input.buyer);
    await lockBuyerEvent(tx, event.id, buyerKeyOf(input.buyer, agentAddress));

    const existing = await findUnlock(tx, event.id, input.buyer, agentAddress);
    if (existing !== null) {
      return unlockedResult(tx, event, existing, true);
    }

    const paymentRequired = paymentRequiredFor(
      input.config,
      event,
      input.resourceUrl,
    );
    if (input.paymentSignatureHeader === null) {
      return {
        kind: 'payment_required',
        paymentRequired,
        paymentRequiredHeader: encodePaymentRequiredHeader(paymentRequired),
        priceAtomic: input.config.unlockPriceAtomic,
        event,
      };
    }

    const requirements = findGatewayRequirements(paymentRequired);
    if (requirements === null) {
      throw new Error('Unlock requirements must offer the Gateway option.');
    }
    if (input.staticPayerCap !== undefined) {
      const cap = input.staticPayerCap;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`payer:${cap.payerAddress.toLowerCase()}`}, 0))`,
      );
      const spent = await staticPayerSpentToday(tx, cap.payerAddress, cap.now);
      if (spent + input.config.unlockPriceAtomic > cap.capAtomic) {
        throw new ApplicationError(
          'STATIC_PAYER_CAP_REACHED',
          'The demo payer has reached its daily spending cap. Try again tomorrow (UTC).',
        );
      }
    }
    const settled = await input.seller.settle({
      paymentSignatureHeader: input.paymentSignatureHeader,
      requirements,
    });
    if (!settled.success) {
      throw new ApplicationError(
        settled.code === 'unavailable'
          ? 'PAYMENT_UNAVAILABLE'
          : 'PAYMENT_INVALID',
        settled.code === 'unavailable'
          ? 'Circle Gateway could not take the payment right now. Nothing was charged; try again shortly.'
          : refusalMessage(settled.reason),
      );
    }

    // Gateway took the payment: record it with the unlock in this same
    // transaction. Never fail silently from here on — the payer has paid.
    const [unlock] = await tx
      .insert(eventUnlocks)
      .values({
        deviceEventId: event.id,
        buyerKind: input.buyer.kind,
        principalId:
          input.buyer.kind === 'owner' ? input.buyer.principalId : null,
        agentAddress: input.buyer.kind === 'agent' ? agentAddress : null,
        payerAddress: settled.payer,
        sellerAddress: input.config.sellerAddress,
        network: settled.network,
        asset: requirements.asset.toLowerCase(),
        amountAtomic: input.config.unlockPriceAtomic,
        settlementReference: settled.reference,
      })
      .onConflictDoNothing({ target: eventUnlocks.settlementReference })
      .returning();
    if (unlock === undefined) {
      // Gateway returned a transfer that already backs another unlock: a
      // replayed payment. Never reveal on it.
      log.error('event.unlock_reference_reused', {
        deviceEventId: event.id,
        buyerKind: input.buyer.kind,
      });
      throw new ApplicationError(
        'PAYMENT_INVALID',
        'This payment was already used for another unlock.',
      );
    }
    log.info('event.unlocked', {
      deviceEventId: event.id,
      buyerKind: input.buyer.kind,
      unlockId: unlock.id,
    });
    return unlockedResult(tx, event, unlock, false);
  });
}

/**
 * Gateway's refusal reasons are short codes (e.g. `insufficient_balance`);
 * anything else is not passed through to the caller.
 */
function refusalMessage(reason: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/i.test(reason)
    ? `The payment was refused (${reason}). Nothing was charged.`
    : 'The payment was refused. Nothing was charged.';
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/** What the static payer has spent today (UTC), in atomic USDC. */
export async function staticPayerSpentToday(
  db: DatabaseExecutor,
  payerAddress: string,
  now: Date = new Date(),
): Promise<bigint> {
  const [row] = await db
    .select({ spent: sum(eventUnlocks.amountAtomic) })
    .from(eventUnlocks)
    .where(
      and(
        eq(eventUnlocks.payerAddress, payerAddress.toLowerCase()),
        gte(eventUnlocks.createdAt, startOfUtcDay(now)),
      ),
    );
  return BigInt(row?.spent ?? '0');
}

/**
 * Unlock from the dashboard or the admin console, paid by the static demo
 * payer: quote, check the daily cap, sign, settle. Paying is the same x402
 * path an agent uses — only the signer is ours.
 */
export async function unlockWithStaticPayer(input: {
  db: Database;
  eventId: string;
  buyer: Extract<UnlockBuyer, { kind: 'owner' | 'admin' }>;
  resourceUrl: string;
  config: PaymentConfig;
  seller: GatewaySeller;
  payer: GatewayBuyer | null;
  now?: Date;
}): Promise<EventUnlockResult> {
  const quote = await requestEventUnlock({
    ...input,
    paymentSignatureHeader: null,
  });
  if (quote.kind === 'unlocked') {
    return quote;
  }
  if (input.payer === null) {
    throw new ApplicationError(
      'STATIC_PAYER_UNAVAILABLE',
      'No demo payer is configured on this deployment, so events cannot be unlocked here.',
    );
  }
  const capCheck = {
    payerAddress: input.payer.address,
    capAtomic: input.config.staticPayerDailyCapAtomic,
    ...(input.now === undefined ? {} : { now: input.now }),
  };
  // Fail fast before signing; checked again under the lock when settling.
  const spent = await staticPayerSpentToday(
    input.db,
    capCheck.payerAddress,
    input.now,
  );
  if (spent + quote.priceAtomic > capCheck.capAtomic) {
    throw new ApplicationError(
      'STATIC_PAYER_CAP_REACHED',
      'The demo payer has reached its daily spending cap. Try again tomorrow (UTC).',
    );
  }
  const balances = await input.payer.getBalances();
  if (balances.gatewayAvailableAtomic < quote.priceAtomic) {
    throw new ApplicationError(
      'STATIC_PAYER_INSUFFICIENT_FUNDS',
      'The demo payer has no USDC left in Circle Gateway. An admin can deposit more from /admin/payments.',
    );
  }
  const paymentSignatureHeader = await input.payer.createPaymentSignatureHeader(
    quote.paymentRequired,
  );
  return requestEventUnlock({
    ...input,
    paymentSignatureHeader,
    staticPayerCap: capCheck,
  });
}
