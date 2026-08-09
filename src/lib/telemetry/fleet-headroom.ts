/**
 * Fleet charge headroom: energy (kWh) the grid can still push into EV packs.
 * headroom = (1 − SoC) × batteryCapacity
 */

export type ChargeHeadroomInput = {
  readonly stateOfChargePercent: number | null;
  readonly batteryCapacityKilowattHours: number | null;
};

export type ChargeHeadroomResult =
  | {
      readonly ok: true;
      readonly headroomKilowattHours: number;
      readonly stateOfChargePercent: number;
      readonly batteryCapacityKilowattHours: number;
    }
  | {
      readonly ok: false;
      readonly reason: 'missing_soc' | 'missing_capacity' | 'invalid_soc';
    };

/**
 * Computes per-vehicle charge headroom. Never coerces missing fields to zero.
 * SoC must be in [0, 100]. Result is rounded to 2 decimal places (demo display).
 */
export function computeChargeHeadroom(
  input: ChargeHeadroomInput,
): ChargeHeadroomResult {
  if (
    input.stateOfChargePercent === null ||
    Number.isNaN(input.stateOfChargePercent)
  ) {
    return { ok: false, reason: 'missing_soc' };
  }
  if (
    input.batteryCapacityKilowattHours === null ||
    Number.isNaN(input.batteryCapacityKilowattHours) ||
    input.batteryCapacityKilowattHours < 0
  ) {
    return { ok: false, reason: 'missing_capacity' };
  }
  if (input.stateOfChargePercent < 0 || input.stateOfChargePercent > 100) {
    return { ok: false, reason: 'invalid_soc' };
  }

  const fractionEmpty = (100 - input.stateOfChargePercent) / 100;
  const raw = fractionEmpty * input.batteryCapacityKilowattHours;
  const headroomKilowattHours = Math.round(raw * 100) / 100;

  return {
    ok: true,
    headroomKilowattHours,
    stateOfChargePercent: input.stateOfChargePercent,
    batteryCapacityKilowattHours: input.batteryCapacityKilowattHours,
  };
}

export function sumChargeHeadroomKilowattHours(
  rows: readonly ChargeHeadroomResult[],
): number {
  let total = 0;
  for (const row of rows) {
    if (row.ok) {
      total += row.headroomKilowattHours;
    }
  }
  return Math.round(total * 100) / 100;
}
