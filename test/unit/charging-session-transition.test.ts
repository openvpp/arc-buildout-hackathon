import { describe, expect, it } from 'vitest';

import {
  chargingSessionIdFor,
  nextChargingTransition,
  type ActiveChargingSession,
} from '@/server/application/telemetry/charging-session-transition';

const at = (iso: string) => new Date(iso);
const context = { electricityPricePerKwh: 0.12, lastSessionEndedAt: null };

const active: ActiveChargingSession = {
  startTime: at('2026-10-12T10:00:00Z'),
  startBatteryLevel: 40,
  endBatteryLevel: 55,
  batteryCapacityKwh: 75,
  lastProviderUpdateAt: at('2026-10-12T10:30:00Z'),
};

describe('nextChargingTransition', () => {
  it('never guesses when the OEM does not report charging status', () => {
    expect(
      nextChargingTransition(
        active,
        {
          isCharging: null,
          batteryLevel: 80,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T11:00:00Z'),
        },
        context,
      ),
    ).toEqual({ kind: 'none', reason: 'unknown_status' });
  });

  it('starts a session when charging begins', () => {
    expect(
      nextChargingTransition(
        null,
        {
          isCharging: true,
          batteryLevel: 40,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T10:00:00Z'),
        },
        context,
      ),
    ).toEqual({
      kind: 'start',
      startTime: at('2026-10-12T10:00:00Z'),
      startBatteryLevel: 40,
      batteryCapacityKwh: 75,
    });
  });

  it('does nothing while idle', () => {
    expect(
      nextChargingTransition(
        null,
        {
          isCharging: false,
          batteryLevel: 40,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T10:00:00Z'),
        },
        context,
      ),
    ).toEqual({ kind: 'none', reason: 'not_charging' });
  });

  it('updates the battery level of an active session', () => {
    expect(
      nextChargingTransition(
        active,
        {
          isCharging: true,
          batteryLevel: 62,
          batteryCapacityKwh: null,
          observedAt: at('2026-10-12T10:45:00Z'),
        },
        context,
      ),
    ).toEqual({
      kind: 'update',
      startBatteryLevel: 40,
      endBatteryLevel: 62,
      batteryCapacityKwh: 75,
      observedAt: at('2026-10-12T10:45:00Z'),
    });
  });

  it('keeps the high-water mark when a later sample dips', () => {
    expect(
      nextChargingTransition(
        active,
        {
          isCharging: true,
          batteryLevel: 30,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T10:45:00Z'),
        },
        context,
      ),
    ).toMatchObject({
      kind: 'update',
      startBatteryLevel: 40,
      endBatteryLevel: 55,
    });
  });

  it('ignores an event older than the last applied update', () => {
    expect(
      nextChargingTransition(
        active,
        {
          isCharging: false,
          batteryLevel: 50,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T10:15:00Z'),
        },
        context,
      ),
    ).toEqual({ kind: 'none', reason: 'stale' });
  });

  it('does not open a phantom session from a replayed pre-close event', () => {
    expect(
      nextChargingTransition(
        null,
        {
          isCharging: true,
          batteryLevel: 50,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T10:15:00Z'),
        },
        { ...context, lastSessionEndedAt: at('2026-10-12T11:00:00Z') },
      ),
    ).toEqual({ kind: 'none', reason: 'stale' });
  });

  it('completes with an estimate labelled as such, priced at the tariff', () => {
    expect(
      nextChargingTransition(
        active,
        {
          isCharging: false,
          batteryLevel: 80,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T11:00:00Z'),
        },
        context,
      ),
    ).toEqual({
      kind: 'close',
      status: 'completed',
      endTime: at('2026-10-12T11:00:00Z'),
      endBatteryLevel: 80,
      batteryCapacityKwh: 75,
      // (80 - 40)% of 75 kWh
      energyDeliveredKwh: 30,
      energyMethod: 'estimated_from_battery_change',
      electricityPrice: 0.12,
      totalCost: 3.6,
    });
  });

  it('cancels a session whose battery level did not rise', () => {
    const result = nextChargingTransition(
      { ...active, startBatteryLevel: 50, endBatteryLevel: 50 },
      {
        isCharging: false,
        batteryLevel: 40,
        batteryCapacityKwh: 75,
        observedAt: at('2026-10-12T11:00:00Z'),
      },
      context,
    );
    expect(result).toMatchObject({
      kind: 'close',
      status: 'cancelled',
      endBatteryLevel: 40,
      energyDeliveredKwh: 0,
    });
  });

  it('charges from the peak when the closing sample falls back to the start', () => {
    const risen: ActiveChargingSession = {
      ...active,
      startBatteryLevel: 20,
      endBatteryLevel: 80,
    };
    expect(
      nextChargingTransition(
        risen,
        {
          isCharging: false,
          batteryLevel: 20,
          batteryCapacityKwh: 75,
          observedAt: at('2026-10-12T11:00:00Z'),
        },
        context,
      ),
    ).toMatchObject({
      kind: 'close',
      status: 'completed',
      endBatteryLevel: 20,
      // (80 - 20)% of 75 kWh
      energyDeliveredKwh: 45,
      energyMethod: 'estimated_from_battery_change',
    });
  });

  it('backfills a missing start level from the first sample that has one', () => {
    const unmeasured: ActiveChargingSession = {
      ...active,
      startBatteryLevel: null,
      endBatteryLevel: null,
      lastProviderUpdateAt: at('2026-10-12T10:00:00Z'),
    };
    const first = nextChargingTransition(
      unmeasured,
      {
        isCharging: true,
        batteryLevel: 40,
        batteryCapacityKwh: 75,
        observedAt: at('2026-10-12T10:20:00Z'),
      },
      context,
    );
    expect(first).toMatchObject({
      kind: 'update',
      startBatteryLevel: 40,
      endBatteryLevel: 40,
    });
    if (first.kind !== 'update') {
      throw new Error('expected an update');
    }
    const second = nextChargingTransition(
      {
        ...unmeasured,
        startBatteryLevel: first.startBatteryLevel,
        endBatteryLevel: first.endBatteryLevel,
        lastProviderUpdateAt: at('2026-10-12T10:20:00Z'),
      },
      {
        isCharging: true,
        batteryLevel: 80,
        batteryCapacityKwh: 75,
        observedAt: at('2026-10-12T10:40:00Z'),
      },
      context,
    );
    expect(second).toMatchObject({
      kind: 'update',
      startBatteryLevel: 40,
      endBatteryLevel: 80,
    });
  });

  it('completes as unmeasured when capacity is unknown', () => {
    const result = nextChargingTransition(
      { ...active, batteryCapacityKwh: null },
      {
        isCharging: false,
        batteryLevel: 80,
        batteryCapacityKwh: null,
        observedAt: at('2026-10-12T11:00:00Z'),
      },
      context,
    );
    expect(result).toMatchObject({
      kind: 'close',
      status: 'completed',
      energyDeliveredKwh: 0,
      energyMethod: 'unknown',
      totalCost: null,
    });
  });
});

describe('chargingSessionIdFor', () => {
  it('is deterministic and built only from our device id', () => {
    expect(chargingSessionIdFor('dev-1', at('2026-10-12T10:00:00Z'))).toBe(
      `session_dev-1_${at('2026-10-12T10:00:00Z').getTime()}`,
    );
  });
});
