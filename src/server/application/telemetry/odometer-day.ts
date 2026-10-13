/**
 * Pure per-UTC-day odometer aggregation. A day's distance is
 * `endKm - startKm`; readings that would make that wrong are counted as
 * anomalies and ignored rather than trusted.
 *
 * Distance since the latest prior day's last reading is attributed to the
 * next day that has a reading, including across silent days — the same
 * approximation already used for overnight driving. The chain is allowed up
 * to `gapDays * MAX_PLAUSIBLE_DAILY_KM`. A larger jump starts the day at its
 * own first reading (`startEstimated`).
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

/** Whole UTC days from `earlierDateUtc` to `laterDateUtc` (Friday → Monday is 3). */
export function utcDayGap(
  earlierDateUtc: string,
  laterDateUtc: string,
): number {
  const earlier = new Date(`${earlierDateUtc}T00:00:00.000Z`).getTime();
  const later = new Date(`${laterDateUtc}T00:00:00.000Z`).getTime();
  const days = Math.round((later - earlier) / 86_400_000);
  return days > 0 ? days : 1;
}

/** How far a reading may sit above the chain anchor after `gapDays` of silence. */
export function chainCapKm(gapDays: number): number {
  const days = gapDays > 0 ? gapDays : 1;
  return days * MAX_PLAUSIBLE_DAILY_KM;
}

/**
 * Starts a day from its first reading. Chains to `previousDayEndKm` when the
 * jump fits in `gapDays` of driving; `gapDays` is 1 for the previous UTC day.
 */
export function openOdometerDay(
  previousDayEndKm: number | null,
  first: OdometerReading,
  gapDays = 1,
): OdometerDay {
  const cap = chainCapKm(gapDays);
  const chainable =
    previousDayEndKm !== null &&
    first.km >= previousDayEndKm &&
    first.km - previousDayEndKm <= cap;
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
  maxKmFromStart = MAX_PLAUSIBLE_DAILY_KM,
): { day: OdometerDay; outcome: 'applied' | 'anomaly' } {
  const backwards = reading.km < day.startKm;
  const implausibleJump = reading.km - day.startKm > maxKmFromStart;
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

/**
 * Rebuilds a day from its readings in time order. The earliest reading is
 * the start, so a later sample that arrived first cannot freeze the day.
 * `gapDays` is the distance to the latest prior day (1 when that day is
 * yesterday, or when there is no prior day).
 */
export function rebuildOdometerDay(
  previousDayEndKm: number | null,
  gapDays: number,
  readings: readonly OdometerReading[],
): OdometerDay {
  if (readings.length === 0) {
    throw new Error('Cannot rebuild an odometer day with no readings');
  }
  const ordered = readings
    .map((reading, index) => ({ reading, index }))
    .sort((left, right) => {
      const delta =
        left.reading.observedAt.getTime() - right.reading.observedAt.getTime();
      return delta !== 0 ? delta : left.index - right.index;
    })
    .map((entry) => entry.reading);
  const first = ordered[0];
  if (first === undefined) {
    throw new Error('Cannot rebuild an odometer day with no readings');
  }
  let day = openOdometerDay(previousDayEndKm, first, gapDays);
  const cap = day.startEstimated ? MAX_PLAUSIBLE_DAILY_KM : chainCapKm(gapDays);
  for (const reading of ordered.slice(1)) {
    day = applyOdometerReading(day, reading, cap).day;
  }
  return day;
}

/** True when `reading` contributed to `day` (it is not an anomaly). */
export function odometerReadingFits(
  day: OdometerDay,
  reading: OdometerReading,
  gapDays: number,
): boolean {
  const cap = day.startEstimated ? MAX_PLAUSIBLE_DAILY_KM : chainCapKm(gapDays);
  return reading.km >= day.startKm && reading.km - day.startKm <= cap;
}
