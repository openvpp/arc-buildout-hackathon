import { and, asc, eq, lt } from 'drizzle-orm';

import {
  aggregateOdometerDay,
  odometerDayColumns,
} from '@/server/application/telemetry/aggregate-odometer-day';
import { utcDateOf } from '@/server/application/telemetry/odometer-day';
import {
  queueDailyOdometerEvent,
  type QueueDeviceEventResult,
} from '@/server/application/telemetry/queue-device-event';
import type { Database } from '@/server/infrastructure/db/client';
import { dailyOdometer, devices } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'finalize-odometer-days' });

/** Late webhooks for a day may still arrive shortly after UTC midnight. */
export const ODOMETER_FINALIZE_GRACE_MS = 30 * 60 * 1000;

/** Bounded per run; the sweep repeats until nothing is due. */
const FINALIZE_BATCH_SIZE = 100;

/**
 * The earliest UTC day that may still receive readings at `now`. Every day
 * strictly before it is over (plus grace) and can be finalized.
 */
export function firstUnfinishedUtcDate(now: Date): string {
  return utcDateOf(new Date(now.getTime() - ODOMETER_FINALIZE_GRACE_MS));
}

export type FinalizeOdometerDaysResult = {
  finalized: number;
  queued: number;
};

/**
 * Finalizes every open day that is over and queues its daily
 * TRIP_COMPLETED event in the same transaction. Idempotent and safe to run
 * from several workers: each day is finalized under the device row lock the
 * webhook path also takes, and only if it is still open.
 */
export async function finalizeDueOdometerDays(
  db: Database,
  now: Date = new Date(),
): Promise<FinalizeOdometerDaysResult> {
  const firstUnfinished = firstUnfinishedUtcDate(now);
  const due = await db
    .select({
      id: dailyOdometer.id,
      deviceId: dailyOdometer.deviceId,
      dateUtc: dailyOdometer.dateUtc,
    })
    .from(dailyOdometer)
    .where(
      and(
        eq(dailyOdometer.status, 'open'),
        lt(dailyOdometer.dateUtc, firstUnfinished),
      ),
    )
    .orderBy(asc(dailyOdometer.dateUtc))
    .limit(FINALIZE_BATCH_SIZE);

  let finalized = 0;
  let queued = 0;
  for (const row of due) {
    const outcome = await db.transaction(async (tx) => {
      await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.id, row.deviceId))
        .limit(1)
        .for('update');
      // Correct a day that was opened before a silent gap was visible.
      // Skip the rewrite when a later day already chained to this end.
      const aggregate = await aggregateOdometerDay(tx, {
        deviceId: row.deviceId,
        dateUtc: row.dateUtc,
      });
      const rebuilt =
        aggregate.status === 'ready' ? odometerDayColumns(aggregate.day) : {};
      const [closed] = await tx
        .update(dailyOdometer)
        .set({
          ...rebuilt,
          status: 'finalized',
          finalizedAt: now,
          updatedAt: now,
        })
        .where(
          and(eq(dailyOdometer.id, row.id), eq(dailyOdometer.status, 'open')),
        )
        .returning({ id: dailyOdometer.id });
      if (closed === undefined) {
        return null;
      }
      return queueDailyOdometerEvent(tx, closed.id);
    });
    if (outcome === null) {
      continue;
    }
    finalized += 1;
    if (outcome.status === 'queued') {
      queued += 1;
    }
    logOutcome(row.id, outcome);
  }
  return { finalized, queued };
}

function logOutcome(dailyOdometerId: string, outcome: QueueDeviceEventResult) {
  log.info('odometer_day.finalized', {
    dailyOdometerId,
    event: outcome.status,
    reason: outcome.status === 'skipped' ? outcome.reason : undefined,
  });
}
