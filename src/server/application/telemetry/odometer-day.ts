/**
 * Pure per-UTC-day odometer aggregation. A day's distance is
 * `endKm - startKm`; readings that would make that wrong are counted as
 * anomalies and ignored rather than trusted.
 *
 * Distance driven between the previous day's last reading and midnight is
 * attributed to the next day — the same approximation as the reference
 * implementation. A day is only chained to the immediately preceding UTC day;
 * after a gap the day starts at its own first reading (`startEstimated`).
 */

/** No EV covers more than this in one UTC day; a larger jump is bad data. */
export const MAX_PLAUSIBLE_DAILY_KM = 2_000;

export type OdometerDay = {
  startKm: number;
  endKm: number;
  startEstimated: boolean;
  readingCount: number;
  anomalyCount: number;
  lastReadingAt: Date | null;
};

export type OdometerReading = { km: number; observedAt: Date };

/** `YYYY-MM-DD` of the UTC calendar day containing `date`. */
export function utcDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The UTC calendar day before `dateUtc` (`YYYY-MM-DD`). */
export function previousUtcDate(dateUtc: string): string {
  const day = new Date(`${dateUtc}T00:00:00.000Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return utcDateOf(day);
}

/** Starts a day from its first reading, chained to yesterday's end if sane. */
export function openOdometerDay(
  previousDayEndKm: number | null,
  first: OdometerReading,
): OdometerDay {
  const chainable =
    previousDayEndKm !== null &&
    first.km >= previousDayEndKm &&
    first.km - previousDayEndKm <= MAX_PLAUSIBLE_DAILY_KM;
  return {
    startKm: chainable ? previousDayEndKm : first.km,
    endKm: first.km,
    startEstimated: !chainable,
    readingCount: 1,
    anomalyCount: 0,
    lastReadingAt: first.observedAt,
  };
}

/**
 * Folds one more reading into an open day. Readings may arrive out of order,
 * so the day's end is the highest plausible reading, not the latest.
 */
export function applyOdometerReading(
  day: OdometerDay,
  reading: OdometerReading,
): { day: OdometerDay; outcome: 'applied' | 'anomaly' } {
  const backwards = reading.km < day.startKm;
  const implausibleJump = reading.km - day.startKm > MAX_PLAUSIBLE_DAILY_KM;
  if (backwards || implausibleJump) {
    return {
      day: { ...day, anomalyCount: day.anomalyCount + 1 },
      outcome: 'anomaly',
    };
  }
  const lastReadingAt =
    day.lastReadingAt === null || reading.observedAt > day.lastReadingAt
      ? reading.observedAt
      : day.lastReadingAt;
  return {
    day: {
      ...day,
      endKm: Math.max(day.endKm, reading.km),
      readingCount: day.readingCount + 1,
      lastReadingAt,
    },
    outcome: 'applied',
  };
}
