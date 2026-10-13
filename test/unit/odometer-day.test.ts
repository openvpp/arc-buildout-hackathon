import { describe, expect, it } from 'vitest';

import {
  applyOdometerReading,
  chainCapKm,
  MAX_PLAUSIBLE_DAILY_KM,
  openOdometerDay,
  previousUtcDate,
  rebuildOdometerDay,
  utcDateOf,
  utcDayGap,
} from '@/server/application/telemetry/odometer-day';

const at = (iso: string) => new Date(iso);

describe('utc day helpers', () => {
  it('uses the UTC calendar day, not local time', () => {
    expect(utcDateOf(at('2026-10-11T23:59:59.999Z'))).toBe('2026-10-11');
    expect(utcDateOf(at('2026-10-12T00:00:00.000Z'))).toBe('2026-10-12');
  });

  it('steps back across month and year boundaries', () => {
    expect(previousUtcDate('2026-03-01')).toBe('2026-02-28');
    expect(previousUtcDate('2027-01-01')).toBe('2026-12-31');
  });

  it('counts a silent weekend as three days and scales the chain cap', () => {
    expect(utcDayGap('2026-10-09', '2026-10-12')).toBe(3);
    expect(chainCapKm(3)).toBe(3 * MAX_PLAUSIBLE_DAILY_KM);
  });
});

describe('openOdometerDay', () => {
  const first = { km: 1050, observedAt: at('2026-10-12T08:00:00Z') };

  it("chains to yesterday's end so overnight driving is counted", () => {
    const day = openOdometerDay(1000, first);
    expect(day).toMatchObject({
      startKm: 1000,
      endKm: 1050,
      startEstimated: false,
      readingCount: 1,
    });
  });

  it('starts at the first reading when there is no previous day', () => {
    expect(openOdometerDay(null, first)).toMatchObject({
      startKm: 1050,
      endKm: 1050,
      startEstimated: true,
    });
  });

  it("does not chain when yesterday's end is ahead of today's reading", () => {
    expect(openOdometerDay(2000, first)).toMatchObject({
      startKm: 1050,
      startEstimated: true,
    });
  });

  it('does not chain across an implausible jump', () => {
    const far = {
      km: 1000 + MAX_PLAUSIBLE_DAILY_KM + 1,
      observedAt: first.observedAt,
    };
    expect(openOdometerDay(1000, far)).toMatchObject({
      startKm: far.km,
      startEstimated: true,
    });
  });

  it('chains a weekend of driving and rejects a jump past the scaled cap', () => {
    const monday = { km: 1400, observedAt: at('2026-10-12T08:00:00Z') };
    expect(openOdometerDay(1000, monday, 3)).toMatchObject({
      startKm: 1000,
      endKm: 1400,
      startEstimated: false,
    });
    const tooFar = {
      km: 1000 + chainCapKm(3) + 1,
      observedAt: monday.observedAt,
    };
    expect(openOdometerDay(1000, tooFar, 3)).toMatchObject({
      startKm: tooFar.km,
      startEstimated: true,
    });
  });
});

describe('rebuildOdometerDay', () => {
  it('keeps an earlier lower reading as the start when it arrives last', () => {
    const day = rebuildOdometerDay(null, 1, [
      { km: 1100, observedAt: at('2026-10-12T18:00:00Z') },
      { km: 1000, observedAt: at('2026-10-12T08:00:00Z') },
    ]);
    expect(day).toMatchObject({
      startKm: 1000,
      endKm: 1100,
      startEstimated: true,
      readingCount: 2,
      anomalyCount: 0,
    });
  });
});

describe('applyOdometerReading', () => {
  const day = openOdometerDay(null, {
    km: 1000,
    observedAt: at('2026-10-12T08:00:00Z'),
  });

  it('extends the day with a higher reading', () => {
    const { day: next, outcome } = applyOdometerReading(day, {
      km: 1042.5,
      observedAt: at('2026-10-12T12:00:00Z'),
    });
    expect(outcome).toBe('applied');
    expect(next).toMatchObject({ endKm: 1042.5, readingCount: 2 });
    expect(next.lastReadingAt).toEqual(at('2026-10-12T12:00:00Z'));
  });

  it('keeps the highest end when an older reading arrives late', () => {
    const later = applyOdometerReading(day, {
      km: 1040,
      observedAt: at('2026-10-12T12:00:00Z'),
    }).day;
    const { day: next, outcome } = applyOdometerReading(later, {
      km: 1020,
      observedAt: at('2026-10-12T10:00:00Z'),
    });
    expect(outcome).toBe('applied');
    expect(next.endKm).toBe(1040);
    expect(next.lastReadingAt).toEqual(at('2026-10-12T12:00:00Z'));
  });

  it('flags a reading below the day start as an anomaly', () => {
    const { day: next, outcome } = applyOdometerReading(day, {
      km: 999,
      observedAt: at('2026-10-12T09:00:00Z'),
    });
    expect(outcome).toBe('anomaly');
    expect(next).toMatchObject({
      endKm: 1000,
      readingCount: 1,
      anomalyCount: 1,
    });
  });

  it('flags an implausible jump as an anomaly', () => {
    const { outcome, day: next } = applyOdometerReading(day, {
      km: 1000 + MAX_PLAUSIBLE_DAILY_KM + 1,
      observedAt: at('2026-10-12T09:00:00Z'),
    });
    expect(outcome).toBe('anomaly');
    expect(next.endKm).toBe(1000);
  });
});
