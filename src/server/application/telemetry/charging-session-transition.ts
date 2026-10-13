/**
 * Pure charging-session state machine driven by Enode `chargeState`.
 *
 *   no session + charging      -> start
 *   active     + charging      -> update (latest battery level)
 *   active     + not charging  -> close (completed | cancelled)
 *   anything   + unknown       -> none (never guess charging status)
 *
 * Energy is estimated from the rise between the start level and the highest
 * level seen, times pack capacity, and is labelled
 * `estimated_from_battery_change` — Enode does not report delivered kWh for
 * vehicles, so nothing here is ever labelled `direct_kwh`.
 */

export type EnergyMethod = 'estimated_from_battery_change' | 'unknown';

export type ActiveChargingSession = {
  startTime: Date;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  batteryCapacityKwh: number | null;
  lastProviderUpdateAt: Date | null;
};

export type ChargeObservation = {
  isCharging: boolean | null;
  batteryLevel: number | null;
  batteryCapacityKwh: number | null;
  observedAt: Date;
};

export type ChargingTransition =
  | { kind: 'none'; reason: 'unknown_status' | 'stale' | 'not_charging' }
  | {
      kind: 'start';
      startTime: Date;
      startBatteryLevel: number | null;
      batteryCapacityKwh: number | null;
    }
  | {
      kind: 'update';
      /** First non-null sample, once one has been seen. */
      startBatteryLevel: number | null;
      /** High-water mark while the session is active. */
      endBatteryLevel: number | null;
      batteryCapacityKwh: number | null;
      observedAt: Date;
    }
  | {
      kind: 'close';
      // 'cancelled': plugged in but the battery level did not rise.
      status: 'completed' | 'cancelled';
      endTime: Date;
      endBatteryLevel: number | null;
      batteryCapacityKwh: number | null;
      energyDeliveredKwh: number;
      energyMethod: EnergyMethod;
      electricityPrice: number | null;
      totalCost: number | null;
    };

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function higherBatteryLevel(
  current: number | null,
  sample: number | null,
): number | null {
  if (current === null) {
    return sample;
  }
  if (sample === null) {
    return current;
  }
  return Math.max(current, sample);
}

export function nextChargingTransition(
  active: ActiveChargingSession | null,
  observation: ChargeObservation,
  context: {
    electricityPricePerKwh: number;
    /** End of the device's most recent closed session, if any. */
    lastSessionEndedAt: Date | null;
  },
): ChargingTransition {
  if (observation.isCharging === null) {
    return { kind: 'none', reason: 'unknown_status' };
  }
  if (
    active?.lastProviderUpdateAt !== null &&
    active?.lastProviderUpdateAt !== undefined &&
    observation.observedAt <= active.lastProviderUpdateAt
  ) {
    return { kind: 'none', reason: 'stale' };
  }

  if (active === null) {
    // A replayed/late event from before the last session ended must not
    // open a phantom session.
    if (
      context.lastSessionEndedAt !== null &&
      observation.observedAt <= context.lastSessionEndedAt
    ) {
      return { kind: 'none', reason: 'stale' };
    }
    if (!observation.isCharging) {
      return { kind: 'none', reason: 'not_charging' };
    }
    return {
      kind: 'start',
      startTime: observation.observedAt,
      startBatteryLevel: observation.batteryLevel,
      batteryCapacityKwh: observation.batteryCapacityKwh,
    };
  }

  const batteryCapacityKwh =
    observation.batteryCapacityKwh ?? active.batteryCapacityKwh;
  const sample = observation.batteryLevel;

  if (observation.isCharging) {
    return {
      kind: 'update',
      startBatteryLevel: active.startBatteryLevel ?? sample,
      endBatteryLevel: higherBatteryLevel(active.endBatteryLevel, sample),
      batteryCapacityKwh,
      observedAt: observation.observedAt,
    };
  }

  return closeChargingSession(active, {
    endTime: observation.observedAt,
    endBatteryLevel: sample ?? active.endBatteryLevel,
    batteryCapacityKwh,
    electricityPricePerKwh: context.electricityPricePerKwh,
  });
}

type CloseTransition = Extract<ChargingTransition, { kind: 'close' }>;

/**
 * Closes a session at `endTime`. Energy uses the high-water mark (the stored
 * peak, or the closing sample when it is higher). The published end level is
 * the closing sample when one was reported. Shared by the live "stopped
 * charging" path and the stale-session sweep.
 */
export function closeChargingSession(
  active: ActiveChargingSession,
  input: {
    endTime: Date;
    endBatteryLevel: number | null;
    batteryCapacityKwh: number | null;
    electricityPricePerKwh: number;
  },
): CloseTransition {
  const endTime =
    input.endTime > active.startTime ? input.endTime : active.startTime;
  const start = active.startBatteryLevel;
  const { batteryCapacityKwh } = input;
  const peak = higherBatteryLevel(
    active.endBatteryLevel,
    input.endBatteryLevel,
  );
  const endBatteryLevel = input.endBatteryLevel ?? active.endBatteryLevel;

  if (start !== null && peak !== null && peak <= start) {
    return {
      kind: 'close',
      status: 'cancelled',
      endTime,
      endBatteryLevel,
      batteryCapacityKwh,
      energyDeliveredKwh: 0,
      energyMethod: 'unknown',
      electricityPrice: null,
      totalCost: null,
    };
  }

  if (start === null || peak === null || batteryCapacityKwh === null) {
    // Charging happened but cannot be measured; recorded off-chain only.
    return {
      kind: 'close',
      status: 'completed',
      endTime,
      endBatteryLevel,
      batteryCapacityKwh,
      energyDeliveredKwh: 0,
      energyMethod: 'unknown',
      electricityPrice: null,
      totalCost: null,
    };
  }

  const energyDeliveredKwh = round(
    ((peak - start) / 100) * batteryCapacityKwh,
    4,
  );
  const price = input.electricityPricePerKwh;
  return {
    kind: 'close',
    status: 'completed',
    endTime,
    endBatteryLevel,
    batteryCapacityKwh,
    energyDeliveredKwh,
    energyMethod: 'estimated_from_battery_change',
    electricityPrice: price,
    totalCost: round(energyDeliveredKwh * price, 4),
  };
}

/** Published on-chain as `sessionId`; built from our device id only. */
export function chargingSessionIdFor(
  deviceId: string,
  startTime: Date,
): string {
  return `session_${deviceId}_${startTime.getTime()}`;
}
