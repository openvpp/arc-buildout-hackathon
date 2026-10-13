import { and, desc, eq, isNotNull } from 'drizzle-orm';

import {
  aggregateOdometerDay,
  odometerDayColumns,
} from '@/server/application/telemetry/aggregate-odometer-day';
import {
  chargingSessionIdFor,
  nextChargingTransition,
  type ChargingTransition,
} from '@/server/application/telemetry/charging-session-transition';
import {
  odometerReadingFits,
  utcDateOf,
} from '@/server/application/telemetry/odometer-day';
import {
  queueChargingSessionEvent,
  type QueueDeviceEventResult,
} from '@/server/application/telemetry/queue-device-event';
import type { DatabaseTransaction } from '@/server/infrastructure/db/client';
import {
  chargingSessions,
  dailyOdometer,
  odometerReadings,
} from '@/server/infrastructure/db/schema';
import type { NormalizedEnodeVehicleEvent } from '@/server/infrastructure/enode/webhook-mapper';

export type OdometerOutcome =
  | 'none'
  | 'recorded'
  | 'duplicate'
  | 'anomaly'
  // The reading's day is closed (finalized, or a later day has already
  // started and chained to its end); kept raw only.
  | 'late';

export type RecordVehicleTelemetryResult = {
  odometer: OdometerOutcome;
  charging: ChargingTransition['kind'];
  /** Set when this event closed a session as `completed`. */
  completedSessionId: string | null;
  /** On-chain publication of a completed session (null otherwise). */
  chargingEvent: QueueDeviceEventResult | null;
};

function numericOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function fixedOrNull(value: number | null, decimals: number): string | null {
  return value === null ? null : value.toFixed(decimals);
}

/**
 * Applies one Enode vehicle event's odometer and charge state to a device.
 * The caller must hold a row lock on the device (`SELECT … FOR UPDATE`) for
 * the duration of `tx`, which serializes all telemetry for that device.
 */
export async function recordVehicleTelemetry(
  tx: DatabaseTransaction,
  input: {
    deviceId: string;
    event: NormalizedEnodeVehicleEvent;
    webhookDeliveryId: string | null;
    receivedAt: Date;
    electricityPricePerKwh: number;
  },
): Promise<RecordVehicleTelemetryResult> {
  const odometer = await recordOdometer(tx, input);
  const charging = await advanceChargingSession(tx, input);
  return { odometer, ...charging };
}

async function recordOdometer(
  tx: DatabaseTransaction,
  input: {
    deviceId: string;
    event: NormalizedEnodeVehicleEvent;
    webhookDeliveryId: string | null;
    receivedAt: Date;
  },
): Promise<OdometerOutcome> {
  const reported = input.event.odometer;
  if (reported === null) {
    return 'none';
  }
  const reading = {
    km: reported.km,
    observedAt:
      reported.observedAt ?? input.event.occurredAt ?? input.receivedAt,
  };

  const [inserted] = await tx
    .insert(odometerReadings)
    .values({
      deviceId: input.deviceId,
      observedAt: reading.observedAt,
      odometerKm: reading.km.toFixed(3),
      webhookDeliveryId: input.webhookDeliveryId,
    })
    .onConflictDoNothing({
      target: [odometerReadings.deviceId, odometerReadings.observedAt],
    })
    .returning({ id: odometerReadings.id });
  if (inserted === undefined) {
    return 'duplicate';
  }

  const dateUtc = utcDateOf(reading.observedAt);
  const [existing] = await tx
    .select({ id: dailyOdometer.id, status: dailyOdometer.status })
    .from(dailyOdometer)
    .where(
      and(
        eq(dailyOdometer.deviceId, input.deviceId),
        eq(dailyOdometer.dateUtc, dateUtc),
      ),
    )
    .limit(1);
  if (existing !== undefined && existing.status !== 'open') {
    return 'late';
  }

  const aggregate = await aggregateOdometerDay(tx, {
    deviceId: input.deviceId,
    dateUtc,
  });
  // A later day already chained to this end. Keep the raw reading and leave
  // the aggregate alone.
  if (aggregate.status === 'frozen') {
    return 'late';
  }
  if (aggregate.status === 'empty') {
    throw new Error(
      `Odometer reading for device ${input.deviceId} on ${dateUtc} was not stored`,
    );
  }

  if (existing === undefined) {
    await tx.insert(dailyOdometer).values({
      deviceId: input.deviceId,
      dateUtc,
      ...odometerDayColumns(aggregate.day),
    });
  } else {
    await tx
      .update(dailyOdometer)
      .set({ ...odometerDayColumns(aggregate.day), updatedAt: new Date() })
      .where(eq(dailyOdometer.id, existing.id));
  }
  return odometerReadingFits(aggregate.day, reading, aggregate.gapDays)
    ? 'recorded'
    : 'anomaly';
}

async function advanceChargingSession(
  tx: DatabaseTransaction,
  input: {
    deviceId: string;
    event: NormalizedEnodeVehicleEvent;
    receivedAt: Date;
    electricityPricePerKwh: number;
  },
): Promise<Omit<RecordVehicleTelemetryResult, 'odometer'>> {
  const chargeState = input.event.chargeState;
  if (chargeState === null) {
    return { charging: 'none', completedSessionId: null, chargingEvent: null };
  }
  const observedAt =
    chargeState.observedAt ?? input.event.occurredAt ?? input.receivedAt;

  const [active] = await tx
    .select()
    .from(chargingSessions)
    .where(
      and(
        eq(chargingSessions.deviceId, input.deviceId),
        eq(chargingSessions.status, 'active'),
      ),
    )
    .limit(1);

  let lastSessionEndedAt: Date | null = null;
  if (active === undefined) {
    const [last] = await tx
      .select({ endTime: chargingSessions.endTime })
      .from(chargingSessions)
      .where(
        and(
          eq(chargingSessions.deviceId, input.deviceId),
          isNotNull(chargingSessions.endTime),
        ),
      )
      .orderBy(desc(chargingSessions.endTime))
      .limit(1);
    lastSessionEndedAt = last?.endTime ?? null;
  }

  const transition = nextChargingTransition(
    active === undefined
      ? null
      : {
          startTime: active.startTime,
          startBatteryLevel: numericOrNull(active.startBatteryLevel),
          endBatteryLevel: numericOrNull(active.endBatteryLevel),
          batteryCapacityKwh: numericOrNull(active.batteryCapacityKwh),
          lastProviderUpdateAt: active.lastProviderUpdateAt,
        },
    {
      isCharging: chargeState.isCharging,
      batteryLevel: chargeState.batteryLevel,
      batteryCapacityKwh: chargeState.batteryCapacityKwh,
      observedAt,
    },
    {
      electricityPricePerKwh: input.electricityPricePerKwh,
      lastSessionEndedAt,
    },
  );

  const location =
    input.event.latitude !== null && input.event.longitude !== null
      ? {
          latitude: input.event.latitude.toFixed(6),
          longitude: input.event.longitude.toFixed(6),
        }
      : {};

  switch (transition.kind) {
    case 'none':
      return {
        charging: 'none',
        completedSessionId: null,
        chargingEvent: null,
      };

    case 'start':
      await tx
        .insert(chargingSessions)
        .values({
          deviceId: input.deviceId,
          sessionId: chargingSessionIdFor(input.deviceId, transition.startTime),
          status: 'active',
          startTime: transition.startTime,
          startBatteryLevel: fixedOrNull(transition.startBatteryLevel, 2),
          endBatteryLevel: fixedOrNull(transition.startBatteryLevel, 2),
          batteryCapacityKwh: fixedOrNull(transition.batteryCapacityKwh, 3),
          lastProviderUpdateAt: transition.startTime,
          ...location,
        })
        .onConflictDoNothing({ target: chargingSessions.sessionId });
      return {
        charging: 'start',
        completedSessionId: null,
        chargingEvent: null,
      };

    case 'update':
      if (active === undefined) {
        return {
          charging: 'none',
          completedSessionId: null,
          chargingEvent: null,
        };
      }
      await tx
        .update(chargingSessions)
        .set({
          startBatteryLevel: fixedOrNull(transition.startBatteryLevel, 2),
          endBatteryLevel: fixedOrNull(transition.endBatteryLevel, 2),
          batteryCapacityKwh: fixedOrNull(transition.batteryCapacityKwh, 3),
          lastProviderUpdateAt: transition.observedAt,
          updatedAt: new Date(),
          ...location,
        })
        .where(eq(chargingSessions.id, active.id));
      return {
        charging: 'update',
        completedSessionId: null,
        chargingEvent: null,
      };

    case 'close':
      if (active === undefined) {
        return {
          charging: 'none',
          completedSessionId: null,
          chargingEvent: null,
        };
      }
      await tx
        .update(chargingSessions)
        .set({
          status: transition.status,
          endTime: transition.endTime,
          endBatteryLevel: fixedOrNull(transition.endBatteryLevel, 2),
          batteryCapacityKwh: fixedOrNull(transition.batteryCapacityKwh, 3),
          energyDeliveredKwh: transition.energyDeliveredKwh.toFixed(4),
          energyMethod: transition.energyMethod,
          electricityPrice: fixedOrNull(transition.electricityPrice, 4),
          totalCost: fixedOrNull(transition.totalCost, 4),
          lastProviderUpdateAt: observedAt,
          updatedAt: new Date(),
        })
        .where(eq(chargingSessions.id, active.id));
      if (transition.status !== 'completed') {
        return {
          charging: 'close',
          completedSessionId: null,
          chargingEvent: null,
        };
      }
      return {
        charging: 'close',
        completedSessionId: active.id,
        // Same transaction as the close: a completed session always has
        // its on-chain event queued (or an explicit reason it isn't).
        chargingEvent: await queueChargingSessionEvent(tx, active.id),
      };
  }
}
