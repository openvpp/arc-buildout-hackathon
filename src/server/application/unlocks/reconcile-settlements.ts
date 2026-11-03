import { and, asc, eq, lt } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { eventUnlocks } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import {
  settlementOutcome,
  type GatewayTransferLookup,
} from '@/server/infrastructure/payments/gateway-transfers';

const log = createServerLogger({ component: 'reconcile-settlements' });

/** A payment is checked at most this often (updated_at marks the check). */
const RECHECK_AFTER_MS = 60_000;

export type ReconcileResult = {
  checked: number;
  settled: number;
  failed: number;
  unavailable: number;
};

/**
 * Moves accepted payments to `settled` (with Gateway's batch transaction)
 * or `failed`, oldest first, within a time budget. Idempotent: only rows
 * still `accepted` are updated, and a lookup error leaves the row as is.
 */
export async function reconcileAcceptedUnlocks(input: {
  db: Database;
  lookup: GatewayTransferLookup;
  now?: Date;
  limit?: number;
  /** Stop starting new lookups after this time (epoch ms). */
  deadline?: number;
}): Promise<ReconcileResult> {
  const now = input.now ?? new Date();
  const result: ReconcileResult = {
    checked: 0,
    settled: 0,
    failed: 0,
    unavailable: 0,
  };
  const due = await input.db
    .select({
      id: eventUnlocks.id,
      settlementReference: eventUnlocks.settlementReference,
    })
    .from(eventUnlocks)
    .where(
      and(
        eq(eventUnlocks.settlementStatus, 'accepted'),
        lt(eventUnlocks.updatedAt, new Date(now.getTime() - RECHECK_AFTER_MS)),
      ),
    )
    .orderBy(asc(eventUnlocks.createdAt))
    .limit(input.limit ?? 50);

  for (const row of due) {
    if (input.deadline !== undefined && Date.now() >= input.deadline) {
      break;
    }
    let outcome;
    try {
      outcome = settlementOutcome(await input.lookup(row.settlementReference));
    } catch (error) {
      result.unavailable += 1;
      log.warn('settlement.lookup_failed', {
        unlockId: row.id,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    result.checked += 1;
    const stillAccepted = and(
      eq(eventUnlocks.id, row.id),
      eq(eventUnlocks.settlementStatus, 'accepted'),
    );
    if (outcome.kind === 'settled') {
      await input.db
        .update(eventUnlocks)
        .set({
          settlementStatus: 'settled',
          settlementTxHash: outcome.txHash,
          settledAt: now,
          updatedAt: now,
        })
        .where(stillAccepted);
      result.settled += 1;
    } else if (outcome.kind === 'failed') {
      await input.db
        .update(eventUnlocks)
        .set({ settlementStatus: 'failed', updatedAt: now })
        .where(stillAccepted);
      result.failed += 1;
      log.warn('settlement.failed', { unlockId: row.id });
    } else {
      // Still batching: note the check so it is not re-polled at once.
      await input.db
        .update(eventUnlocks)
        .set({ updatedAt: now })
        .where(stillAccepted);
    }
  }
  return result;
}
