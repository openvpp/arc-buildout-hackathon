import { and, asc, desc, eq, gt, gte, lt } from 'drizzle-orm';

import {
  rebuildOdometerDay,
  utcDayGap,
  type OdometerDay,
} from '@/server/application/telemetry/odometer-day';
import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import {
  dailyOdometer,
  odometerReadings,
} from '@/server/infrastructure/db/schema';

export function odometerDayColumns(day: OdometerDay) {
  return {
    startOdometerKm: day.startKm.toFixed(3),
    endOdometerKm: day.endKm.toFixed(3),
    startEstimated: day.startEstimated,
    readingCount: day.readingCount,
    anomalyCount: day.anomalyCount,
    lastReadingAt: day.lastReadingAt,
  };
}

export type AggregateOdometerDayResult =
  | { status: 'frozen' }
  | { status: 'empty' }
  | { status: 'ready'; day: OdometerDay; gapDays: number };

/**
 * Rebuilds one UTC day from its raw readings, chained to the latest prior
 * day. `frozen` when a later day already exists: that day's start used this
 * day's end, so changing it would count the same kilometres twice.
 */
export async function aggregateOdometerDay(
  db: DatabaseExecutor,
  input: { deviceId: string; dateUtc: string },
): Promise<AggregateOdometerDayResult> {
  const [laterDay] = await db
    .select({ id: dailyOdometer.id })
    .from(dailyOdometer)
    .where(
      and(
        eq(dailyOdometer.deviceId, input.deviceId),
        gt(dailyOdometer.dateUtc, input.dateUtc),
      ),
    )
    .limit(1);
  if (laterDay !== undefined) {
    return { status: 'frozen' };
  }

  const [previous] = await db
    .select({
      endOdometerKm: dailyOdometer.endOdometerKm,
      dateUtc: dailyOdometer.dateUtc,
    })
    .from(dailyOdometer)
    .where(
      and(
        eq(dailyOdometer.deviceId, input.deviceId),
        lt(dailyOdometer.dateUtc, input.dateUtc),
      ),
    )
    .orderBy(desc(dailyOdometer.dateUtc))
    .limit(1);

  const dayStart = new Date(`${input.dateUtc}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const rows = await db
    .select({
      odometerKm: odometerReadings.odometerKm,
      observedAt: odometerReadings.observedAt,
    })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.deviceId, input.deviceId),
        gte(odometerReadings.observedAt, dayStart),
        lt(odometerReadings.observedAt, dayEnd),
      ),
    )
    .orderBy(asc(odometerReadings.observedAt));
  if (rows.length === 0) {
    return { status: 'empty' };
  }

  const gapDays =
    previous === undefined ? 1 : utcDayGap(previous.dateUtc, input.dateUtc);
  return {
    status: 'ready',
    gapDays,
    day: rebuildOdometerDay(
      previous === undefined ? null : Number(previous.endOdometerKm),
      gapDays,
      rows.map((row) => ({
        km: Number(row.odometerKm),
        observedAt: row.observedAt,
      })),
    ),
  };
}
