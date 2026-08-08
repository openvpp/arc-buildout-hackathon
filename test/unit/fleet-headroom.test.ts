import { describe, expect, it } from 'vitest';

import {
  computeChargeHeadroom,
  sumChargeHeadroomKilowattHours,
} from '@/server/domain/telemetry/fleet-headroom';

describe('computeChargeHeadroom', () => {
  it('matches the demo fleet example (75 kWh packs)', () => {
    const cars = [
      { stateOfChargePercent: 10, batteryCapacityKilowattHours: 75 },
      { stateOfChargePercent: 20, batteryCapacityKilowattHours: 75 },
      { stateOfChargePercent: 10, batteryCapacityKilowattHours: 75 },
      { stateOfChargePercent: 95, batteryCapacityKilowattHours: 75 },
      { stateOfChargePercent: 100, batteryCapacityKilowattHours: 75 },
    ].map((input) => computeChargeHeadroom(input));

    expect(cars.map((c) => (c.ok ? c.headroomKilowattHours : null))).toEqual([
      67.5, 60, 67.5, 3.75, 0,
    ]);
    expect(sumChargeHeadroomKilowattHours(cars)).toBe(198.75);
  });

  it('does not coerce missing fields to zero', () => {
    expect(
      computeChargeHeadroom({
        stateOfChargePercent: null,
        batteryCapacityKilowattHours: 75,
      }),
    ).toEqual({ ok: false, reason: 'missing_soc' });
    expect(
      computeChargeHeadroom({
        stateOfChargePercent: 50,
        batteryCapacityKilowattHours: null,
      }),
    ).toEqual({ ok: false, reason: 'missing_capacity' });
  });

  it('rejects out-of-range SoC', () => {
    expect(
      computeChargeHeadroom({
        stateOfChargePercent: 101,
        batteryCapacityKilowattHours: 75,
      }),
    ).toEqual({ ok: false, reason: 'invalid_soc' });
  });
});
