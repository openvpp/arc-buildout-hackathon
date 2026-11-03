import { and, desc, eq, sql } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { EventUnlockResult } from '@/server/application/unlocks/event-unlock';
import { latestVerification } from '@/server/application/verification/verify-stored-event';
import type { Database } from '@/server/infrastructure/db/client';
import { deviceEvents } from '@/server/infrastructure/db/schema';
import type { PaymentConfig } from '@/server/infrastructure/payments/payment-config';

/**
 * One anchored event as listed to agents: only what is already public
 * on-chain (the payload is the event's data), its verdict, and its price.
 */
export type AgentCatalogEvent = {
  eventId: string;
  tokenId: string | null;
  eventType: number;
  occurredAt: string;
  chainId: string | null;
  contractAddress: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  payloadJson: string;
  payloadHash: string;
  payloadVersion: number;
  verificationStatus: string;
  priceAtomic: string;
  unlockPath: string;
};

/** Anchored events, newest first, optionally for one DeviceNFT. */
export async function listAgentCatalog(
  db: Database,
  input: {
    config: PaymentConfig;
    limit?: number;
    cursor?: string;
    tokenId?: string;
  },
): Promise<{ events: AgentCatalogEvent[]; nextCursor: string | null }> {
  const limit = Math.min(input.limit ?? 25, 100);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid events cursor.');
  }
  const rows = await db
    .select()
    .from(deviceEvents)
    .where(
      and(
        eq(deviceEvents.status, 'confirmed'),
        input.tokenId === undefined
          ? undefined
          : eq(deviceEvents.tokenId, input.tokenId),
        cursor === null
          ? undefined
          : sql`(${deviceEvents.occurredAt}, ${deviceEvents.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(deviceEvents.occurredAt), desc(deviceEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    events: page.map((row) => ({
      eventId: row.id,
      tokenId: row.tokenId,
      eventType: row.eventType,
      occurredAt: row.occurredAt.toISOString(),
      chainId: row.chainId?.toString() ?? null,
      contractAddress: row.contractAddress,
      transactionHash: row.transactionHash,
      blockNumber: row.blockNumber?.toString() ?? null,
      payloadJson: row.payloadJson,
      payloadHash: row.payloadHash,
      payloadVersion: row.payloadVersion,
      verificationStatus: row.verificationStatus,
      priceAtomic: input.config.unlockPriceAtomic.toString(),
      unlockPath: `/api/v1/agent/events/${row.id}`,
    })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.occurredAt, last.id)
        : null,
  };
}

/** What a paid agent request returns: the unlocked record and its proof. */
export async function agentUnlockedResponse(
  db: Database,
  result: Extract<EventUnlockResult, { kind: 'unlocked' }>,
) {
  const { event, unlock, content } = result;
  const verification = await latestVerification(db, event.id);
  return {
    eventId: event.id,
    alreadyUnlocked: result.alreadyUnlocked,
    event: {
      tokenId: event.tokenId,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
      chainId: event.chainId?.toString() ?? null,
      contractAddress: event.contractAddress,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber?.toString() ?? null,
    },
    payloadJson: content.payloadJson,
    payloadHash: content.payloadHash,
    payloadVersion: content.payloadVersion,
    // Without location and without the salt (see unlock-content.ts).
    record: content.record,
    verification:
      verification === null
        ? null
        : {
            verdict: verification.verdict,
            checks: verification.checks,
            checkedAt: verification.checkedAt.toISOString(),
          },
    receipt: {
      amountAtomic: unlock.amountAtomic.toString(),
      asset: unlock.asset,
      network: unlock.network,
      payer: unlock.payerAddress,
      settlementReference: unlock.settlementReference,
      settlementStatus: unlock.settlementStatus,
      settlementTxHash: unlock.settlementTxHash,
    },
  };
}
