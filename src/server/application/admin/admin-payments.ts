import { and, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { EventUnlockRow } from '@/server/application/unlocks/event-unlock';
import type { Database } from '@/server/infrastructure/db/client';
import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';

export type AdminPaymentRow = {
  unlock: EventUnlockRow;
  eventType: number;
  deviceId: string;
  deviceName: string | null;
  vendor: string | null;
  model: string | null;
};

const createdAtMs = sql`date_trunc('milliseconds', ${eventUnlocks.createdAt})`;

/** Every paid unlock (owners, admin, agents), newest first, paginated. */
export async function listAdminPayments(
  db: Database,
  input: { limit?: number; cursor?: string },
): Promise<{ payments: AdminPaymentRow[]; nextCursor: string | null }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid payments cursor.');
  }
  const rows = await db
    .select({
      unlock: eventUnlocks,
      eventType: deviceEvents.eventType,
      deviceId: devices.id,
      deviceName: devices.displayName,
      vendor: devices.vendor,
      model: devices.model,
    })
    .from(eventUnlocks)
    .innerJoin(deviceEvents, eq(deviceEvents.id, eventUnlocks.deviceEventId))
    .innerJoin(devices, eq(devices.id, deviceEvents.deviceId))
    .where(
      cursor === null
        ? undefined
        : sql`(${createdAtMs}, ${eventUnlocks.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
    )
    .orderBy(desc(createdAtMs), desc(eventUnlocks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    payments: page,
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.unlock.createdAt, last.unlock.id)
        : null,
  };
}

export type PaymentTotals = {
  count: number;
  revenueAtomic: bigint;
  settledAtomic: bigint;
  acceptedCount: number;
  byBuyer: { owner: number; admin: number; agent: number };
};

/** Totals across every unlock. */
export async function getPaymentTotals(db: Database): Promise<PaymentTotals> {
  const [row] = await db
    .select({
      count: count(),
      revenue: sum(eventUnlocks.amountAtomic),
      settled: sql<
        string | null
      >`sum(${eventUnlocks.amountAtomic}) filter (where ${eventUnlocks.settlementStatus} = 'settled')`,
      accepted:
        sql<number>`count(*) filter (where ${eventUnlocks.settlementStatus} = 'accepted')`.mapWith(
          Number,
        ),
      owner:
        sql<number>`count(*) filter (where ${eventUnlocks.buyerKind} = 'owner')`.mapWith(
          Number,
        ),
      admin:
        sql<number>`count(*) filter (where ${eventUnlocks.buyerKind} = 'admin')`.mapWith(
          Number,
        ),
      agent:
        sql<number>`count(*) filter (where ${eventUnlocks.buyerKind} = 'agent')`.mapWith(
          Number,
        ),
    })
    .from(eventUnlocks);
  return {
    count: row?.count ?? 0,
    revenueAtomic: BigInt(row?.revenue ?? '0'),
    settledAtomic: BigInt(row?.settled ?? '0'),
    acceptedCount: row?.accepted ?? 0,
    byBuyer: {
      owner: row?.owner ?? 0,
      admin: row?.admin ?? 0,
      agent: row?.agent ?? 0,
    },
  };
}

/** The admin's own unlocks of these events, keyed by event id. */
export async function adminUnlocksByEvent(
  db: Database,
  eventIds: readonly string[],
): Promise<Map<string, EventUnlockRow>> {
  const byEvent = new Map<string, EventUnlockRow>();
  if (eventIds.length === 0) {
    return byEvent;
  }
  const rows = await db
    .select()
    .from(eventUnlocks)
    .where(
      and(
        eq(eventUnlocks.buyerKind, 'admin'),
        inArray(eventUnlocks.deviceEventId, [...eventIds]),
      ),
    );
  for (const row of rows) {
    byEvent.set(row.deviceEventId, row);
  }
  return byEvent;
}

/**
 * A device's newest anchored events the admin has not paid for yet
 * (bounded): what "Fetch telemetry (paid)" buys.
 */
export async function unpaidAnchoredEventIds(
  db: Database,
  deviceId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: deviceEvents.id })
    .from(deviceEvents)
    .where(
      and(
        eq(deviceEvents.deviceId, deviceId),
        eq(deviceEvents.status, 'confirmed'),
        sql`not exists (select 1 from ${eventUnlocks} where ${eventUnlocks.deviceEventId} = ${deviceEvents.id} and ${eventUnlocks.buyerKind} = 'admin')`,
      ),
    )
    .orderBy(desc(deviceEvents.occurredAt))
    .limit(limit);
  return rows.map((row) => row.id);
}
