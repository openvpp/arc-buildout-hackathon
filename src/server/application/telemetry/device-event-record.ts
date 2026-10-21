import { randomBytes } from 'node:crypto';

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { keccak256, stringToHex } from 'viem';

import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import {
  chargingSessions,
  dailyOdometer,
  odometerReadings,
} from '@/server/infrastructure/db/schema';

/**
 * The full off-chain record behind a published event, including fields that
 * are never published (location, raw readings). Only its salted hash —
 * `recordHash` — goes on-chain, so whoever holds the record and salt can
 * prove it is unchanged without the record ever being public.
 *
 * Canonical form: fixed key order, numerics as Postgres's exact decimal
 * strings (no float rounding), timestamps as ISO-8601 UTC.
 */
export const RECORD_FORMAT_VERSION = 1;

/** Payloads with `recordHash` are payload version 2 (v1 has none). */
export const PAYLOAD_VERSION_WITH_RECORD_HASH = 2;

type ChargingSessionRow = typeof chargingSessions.$inferSelect;
type DailyOdometerRow = typeof dailyOdometer.$inferSelect;
type OdometerReadingRow = typeof odometerReadings.$inferSelect;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function buildChargingSessionRecord(row: ChargingSessionRow): string {
  return JSON.stringify({
    kind: 'charging_session',
    recordVersion: RECORD_FORMAT_VERSION,
    id: row.id,
    deviceId: row.deviceId,
    sessionId: row.sessionId,
    status: row.status,
    startTime: iso(row.startTime),
    endTime: iso(row.endTime),
    startBatteryLevel: row.startBatteryLevel,
    endBatteryLevel: row.endBatteryLevel,
    batteryCapacityKwh: row.batteryCapacityKwh,
    energyDeliveredKwh: row.energyDeliveredKwh,
    energyMethod: row.energyMethod,
    electricityPrice: row.electricityPrice,
    totalCost: row.totalCost,
    currency: row.currency,
    latitude: row.latitude,
    longitude: row.longitude,
  });
}

export function buildDailyOdometerRecord(
  day: DailyOdometerRow,
  readings: readonly Pick<
    OdometerReadingRow,
    'id' | 'observedAt' | 'odometerKm'
  >[],
): string {
  const ordered = [...readings].sort(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  return JSON.stringify({
    kind: 'daily_odometer',
    recordVersion: RECORD_FORMAT_VERSION,
    id: day.id,
    deviceId: day.deviceId,
    dateUtc: day.dateUtc,
    startOdometerKm: day.startOdometerKm,
    endOdometerKm: day.endOdometerKm,
    startEstimated: day.startEstimated,
    readingCount: day.readingCount,
    anomalyCount: day.anomalyCount,
    readings: ordered.map((reading) => ({
      id: reading.id,
      observedAt: reading.observedAt.toISOString(),
      odometerKm: reading.odometerKm,
    })),
  });
}

/** 32 random bytes; kept off-chain so record values can't be brute-forced. */
export function newRecordSalt(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

export function computeRecordHash(salt: string, recordJson: string): string {
  return keccak256(stringToHex(`${salt}:${recordJson}`));
}

/** Readings of a UTC day (by observed time). */
async function readingsForDay(
  db: DatabaseExecutor,
  day: Pick<DailyOdometerRow, 'deviceId' | 'dateUtc'>,
) {
  const start = new Date(`${day.dateUtc}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return db
    .select({
      id: odometerReadings.id,
      observedAt: odometerReadings.observedAt,
      odometerKm: odometerReadings.odometerKm,
    })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.deviceId, day.deviceId),
        gte(odometerReadings.observedAt, start),
        lt(odometerReadings.observedAt, end),
      ),
    )
    .orderBy(asc(odometerReadings.observedAt));
}

/** The record as of publishing: the day and every reading it had then. */
export async function snapshotDailyOdometerRecord(
  db: DatabaseExecutor,
  day: DailyOdometerRow,
): Promise<string> {
  return buildDailyOdometerRecord(day, await readingsForDay(db, day));
}

function snapshotReadingIds(value: unknown): string[] | null {
  if (value === null || typeof value !== 'object' || !('readings' in value)) {
    return null;
  }
  const readings = (value as { readings: unknown }).readings;
  if (!Array.isArray(readings)) {
    return null;
  }
  const ids: string[] = [];
  for (const reading of readings) {
    if (
      reading === null ||
      typeof reading !== 'object' ||
      typeof (reading as { id?: unknown }).id !== 'string'
    ) {
      return null;
    }
    ids.push((reading as { id: string }).id);
  }
  return ids;
}

export type RecomputedRecord =
  | { status: 'ok'; recordJson: string }
  | { status: 'source_missing' }
  | { status: 'snapshot_unreadable' };

/**
 * Rebuilds the record from the database *now*, for verification. A daily
 * record is rebuilt from the same reading ids the snapshot listed: an edited
 * or deleted reading changes the hash, while readings that arrived after
 * publishing (late, raw-only) are not part of the record.
 */
export async function recomputeEventRecord(
  db: DatabaseExecutor,
  input: {
    sourceType: string;
    sourceId: string;
    snapshotJson: string;
  },
): Promise<RecomputedRecord> {
  if (input.sourceType === 'charging_session') {
    const [row] = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.id, input.sourceId))
      .limit(1);
    return row === undefined
      ? { status: 'source_missing' }
      : { status: 'ok', recordJson: buildChargingSessionRecord(row) };
  }
  if (input.sourceType === 'daily_odometer') {
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(input.snapshotJson) as unknown;
    } catch {
      return { status: 'snapshot_unreadable' };
    }
    const ids = snapshotReadingIds(snapshot);
    if (ids === null) {
      return { status: 'snapshot_unreadable' };
    }
    const [day] = await db
      .select()
      .from(dailyOdometer)
      .where(eq(dailyOdometer.id, input.sourceId))
      .limit(1);
    if (day === undefined) {
      return { status: 'source_missing' };
    }
    const readings =
      ids.length === 0
        ? []
        : await db
            .select({
              id: odometerReadings.id,
              observedAt: odometerReadings.observedAt,
              odometerKm: odometerReadings.odometerKm,
            })
            .from(odometerReadings)
            .where(
              and(
                eq(odometerReadings.deviceId, day.deviceId),
                inArray(odometerReadings.id, ids),
              ),
            );
    return {
      status: 'ok',
      recordJson: buildDailyOdometerRecord(day, readings),
    };
  }
  return { status: 'source_missing' };
}
