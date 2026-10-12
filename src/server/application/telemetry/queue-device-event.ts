import { eq } from 'drizzle-orm';

import {
  buildChargingCompletedPayload,
  buildDailyOdometerPayload,
  DEVICE_EVENT_TYPES,
  MIN_PUBLISHED_DAILY_KM,
} from '@/server/application/telemetry/device-event-payloads';
import { hashDeviceEventPayload } from '@/server/infrastructure/blockchain/device-event-recorder';
import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
import {
  chargingSessions,
  dailyOdometer,
  deviceEvents,
} from '@/server/infrastructure/db/schema';

export const RECORD_DEVICE_EVENT_JOB = 'RECORD_DEVICE_EVENT';

export type QueueDeviceEventResult =
  | { status: 'queued'; deviceEventId: string }
  // Already queued/published for this source — publishing is once-only.
  | { status: 'exists' }
  // Not publishable (e.g. energy couldn't be measured); stays off-chain.
  | { status: 'skipped'; reason: string };

/**
 * Inserts the device_events row (payload frozen here) and its outbox job.
 * Run inside the same transaction that produced the source row, so a
 * completed session/day can never exist without its queued event.
 */
async function insertDeviceEvent(
  db: DatabaseExecutor,
  input: {
    deviceId: string;
    eventType: number;
    sourceType: 'charging_session' | 'daily_odometer';
    sourceId: string;
    occurredAt: Date;
    payloadJson: string;
  },
): Promise<QueueDeviceEventResult> {
  const [row] = await db
    .insert(deviceEvents)
    .values({
      ...input,
      payloadHash: hashDeviceEventPayload(input.payloadJson),
      status: 'queued',
    })
    .onConflictDoNothing({
      target: [
        deviceEvents.sourceType,
        deviceEvents.sourceId,
        deviceEvents.eventType,
      ],
    })
    .returning({ id: deviceEvents.id });
  if (row === undefined) {
    return { status: 'exists' };
  }
  await enqueueOutboxEvent(db, {
    aggregateType: 'device_event',
    aggregateId: row.id,
    eventType: RECORD_DEVICE_EVENT_JOB,
    payload: { deviceEventId: row.id },
  });
  return { status: 'queued', deviceEventId: row.id };
}

export async function queueChargingSessionEvent(
  db: DatabaseExecutor,
  chargingSessionId: string,
): Promise<QueueDeviceEventResult> {
  const [session] = await db
    .select()
    .from(chargingSessions)
    .where(eq(chargingSessions.id, chargingSessionId))
    .limit(1);
  if (session === undefined) {
    throw new Error(`Charging session not found: ${chargingSessionId}`);
  }
  if (session.status !== 'completed' || session.endTime === null) {
    return { status: 'skipped', reason: 'not_completed' };
  }
  const energyDeliveredKwh = Number(session.energyDeliveredKwh);
  if (
    session.energyMethod !== 'estimated_from_battery_change' ||
    !(energyDeliveredKwh > 0)
  ) {
    return { status: 'skipped', reason: 'energy_not_measured' };
  }

  return insertDeviceEvent(db, {
    deviceId: session.deviceId,
    eventType: DEVICE_EVENT_TYPES.CHARGING_COMPLETED,
    sourceType: 'charging_session',
    sourceId: session.id,
    occurredAt: session.endTime,
    payloadJson: buildChargingCompletedPayload({
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      startTime: session.startTime,
      endTime: session.endTime,
      energyDeliveredKwh,
      endBatteryLevel:
        session.endBatteryLevel === null
          ? null
          : Number(session.endBatteryLevel),
      energyMethod: 'estimated_from_battery_change',
      electricityPrice:
        session.electricityPrice === null
          ? null
          : Number(session.electricityPrice),
      totalCost: session.totalCost === null ? null : Number(session.totalCost),
      currency: session.currency,
    }),
  });
}

export async function queueDailyOdometerEvent(
  db: DatabaseExecutor,
  dailyOdometerId: string,
): Promise<QueueDeviceEventResult> {
  const [day] = await db
    .select()
    .from(dailyOdometer)
    .where(eq(dailyOdometer.id, dailyOdometerId))
    .limit(1);
  if (day === undefined) {
    throw new Error(`Daily odometer row not found: ${dailyOdometerId}`);
  }
  if (day.status !== 'finalized') {
    return { status: 'skipped', reason: 'not_finalized' };
  }
  const distanceKm = Number(day.endOdometerKm) - Number(day.startOdometerKm);
  if (distanceKm < MIN_PUBLISHED_DAILY_KM) {
    return { status: 'skipped', reason: 'no_distance' };
  }
  const end = new Date(`${day.dateUtc}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);

  return insertDeviceEvent(db, {
    deviceId: day.deviceId,
    eventType: DEVICE_EVENT_TYPES.TRIP_COMPLETED,
    sourceType: 'daily_odometer',
    sourceId: day.id,
    occurredAt: end,
    payloadJson: buildDailyOdometerPayload({
      deviceId: day.deviceId,
      dateUtc: day.dateUtc,
      startOdometerKm: Number(day.startOdometerKm),
      endOdometerKm: Number(day.endOdometerKm),
      startEstimated: day.startEstimated,
    }),
  });
}
