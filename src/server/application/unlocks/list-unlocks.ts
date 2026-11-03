import { and, count, desc, eq, inArray, sql, sum } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { EventUnlockRow } from '@/server/application/unlocks/event-unlock';
import {
  buildUnlockedContent,
  type UnlockedContent,
} from '@/server/application/unlocks/unlock-content';
import type { Database } from '@/server/infrastructure/db/client';
import {
  deviceEvents,
  devices,
  eventUnlocks,
} from '@/server/infrastructure/db/schema';

/** This user's unlocks of these events, keyed by event id. */
export async function unlocksByEventForPrincipal(
  db: Database,
  principalId: string,
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
        eq(eventUnlocks.buyerKind, 'owner'),
        eq(eventUnlocks.principalId, principalId),
        inArray(eventUnlocks.deviceEventId, [...eventIds]),
      ),
    );
  for (const row of rows) {
    byEvent.set(row.deviceEventId, row);
  }
  return byEvent;
}

/**
 * This user's unlocked events among these, with what each reveals. Only the
 * events they paid for are read in full.
 */
export async function unlockedContentForPrincipal(
  db: Database,
  principalId: string,
  eventIds: readonly string[],
): Promise<Map<string, { unlock: EventUnlockRow; content: UnlockedContent }>> {
  const unlocks = await unlocksByEventForPrincipal(db, principalId, eventIds);
  const result = new Map<
    string,
    { unlock: EventUnlockRow; content: UnlockedContent }
  >();
  if (unlocks.size === 0) {
    return result;
  }
  const events = await db
    .select()
    .from(deviceEvents)
    .where(inArray(deviceEvents.id, [...unlocks.keys()]));
  for (const event of events) {
    const unlock = unlocks.get(event.id);
    if (unlock !== undefined) {
      result.set(event.id, {
        unlock,
        content: await buildUnlockedContent(db, event, 'owner'),
      });
    }
  }
  return result;
}

export type PrincipalUnlockRow = {
  unlock: EventUnlockRow;
  eventType: number;
  occurredAt: Date;
  deviceId: string;
  deviceName: string | null;
  vendor: string | null;
  model: string | null;
};

// Compared at millisecond precision (created_at has microseconds; the
// cursor carries milliseconds), so no row at a page boundary is skipped.
const createdAtMs = sql`date_trunc('milliseconds', ${eventUnlocks.createdAt})`;

/** This user's paid unlocks, newest first (keyset-paginated). */
export async function listUnlocksForPrincipal(
  db: Database,
  input: { principalId: string; limit?: number; cursor?: string },
): Promise<{ unlocks: PrincipalUnlockRow[]; nextCursor: string | null }> {
  const limit = Math.min(input.limit ?? 25, 100);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid payments cursor.');
  }
  const rows = await db
    .select({
      unlock: eventUnlocks,
      eventType: deviceEvents.eventType,
      occurredAt: deviceEvents.occurredAt,
      deviceId: devices.id,
      deviceName: devices.displayName,
      vendor: devices.vendor,
      model: devices.model,
    })
    .from(eventUnlocks)
    .innerJoin(deviceEvents, eq(deviceEvents.id, eventUnlocks.deviceEventId))
    .innerJoin(devices, eq(devices.id, deviceEvents.deviceId))
    .where(
      and(
        eq(eventUnlocks.buyerKind, 'owner'),
        eq(eventUnlocks.principalId, input.principalId),
        cursor === null
          ? undefined
          : sql`(${createdAtMs}, ${eventUnlocks.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(createdAtMs), desc(eventUnlocks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    unlocks: page,
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.unlock.createdAt, last.unlock.id)
        : null,
  };
}

export type UserOverview = {
  devices: number;
  minted: number;
  anchoredEvents: number;
  verifiedEvents: number;
  unlockedEvents: number;
  spentAtomic: bigint;
};

/** Counts for the user's dashboard: their devices, records and unlocks. */
export async function getUserOverview(
  db: Database,
  input: { principalId: string; walletId: string },
): Promise<UserOverview> {
  const [deviceCounts] = await db
    .select({
      devices: count(),
      minted:
        sql<number>`count(*) filter (where ${devices.mintStatus} = 'minted')`.mapWith(
          Number,
        ),
    })
    .from(devices)
    .where(eq(devices.walletId, input.walletId));
  const [eventCounts] = await db
    .select({
      anchored:
        sql<number>`count(*) filter (where ${deviceEvents.status} = 'confirmed')`.mapWith(
          Number,
        ),
      verified:
        sql<number>`count(*) filter (where ${deviceEvents.verificationStatus} in ('verified', 'verified_with_warnings'))`.mapWith(
          Number,
        ),
    })
    .from(deviceEvents)
    .innerJoin(devices, eq(devices.id, deviceEvents.deviceId))
    .where(eq(devices.walletId, input.walletId));
  const [unlockTotals] = await db
    .select({ unlocked: count(), spent: sum(eventUnlocks.amountAtomic) })
    .from(eventUnlocks)
    .where(
      and(
        eq(eventUnlocks.buyerKind, 'owner'),
        eq(eventUnlocks.principalId, input.principalId),
      ),
    );
  return {
    devices: deviceCounts?.devices ?? 0,
    minted: deviceCounts?.minted ?? 0,
    anchoredEvents: eventCounts?.anchored ?? 0,
    verifiedEvents: eventCounts?.verified ?? 0,
    unlockedEvents: unlockTotals?.unlocked ?? 0,
    spentAtomic: BigInt(unlockTotals?.spent ?? '0'),
  };
}
