import { and, asc, eq, lt } from 'drizzle-orm';

import { closeChargingSession } from '@/server/application/telemetry/charging-session-transition';
import { queueChargingSessionEvent } from '@/server/application/telemetry/queue-device-event';
import type { Database } from '@/server/infrastructure/db/client';
import { chargingSessions, devices } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'close-stale-charging-sessions' });

/**
 * An active session with no provider update for this long is closed: Enode
 * missed (or never sent) the "stopped charging" update. A real charge that
 * outlasts this keeps sending updates, so it is not affected.
 */
export const STALE_CHARGING_SESSION_MS = 24 * 60 * 60 * 1000;

const STALE_BATCH_SIZE = 100;

function numericOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/**
 * Closes stale active sessions at their last observation, using the last
 * battery level seen — energy up to then was really delivered; anything
 * after is unknown and not claimed. A later "charging" update opens a new
 * session (it is newer than this one's end).
 */
export async function closeStaleChargingSessions(
  db: Database,
  input: { now?: Date; electricityPricePerKwh: number },
): Promise<{ closed: number; queued: number }> {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - STALE_CHARGING_SESSION_MS);
  const stale = await db
    .select({ id: chargingSessions.id, deviceId: chargingSessions.deviceId })
    .from(chargingSessions)
    .where(
      and(
        eq(chargingSessions.status, 'active'),
        lt(chargingSessions.lastProviderUpdateAt, staleBefore),
      ),
    )
    .orderBy(asc(chargingSessions.lastProviderUpdateAt))
    .limit(STALE_BATCH_SIZE);

  let closed = 0;
  let queued = 0;
  for (const row of stale) {
    const outcome = await db.transaction(async (tx) => {
      // Same lock as the webhook path, so a late update can't interleave.
      await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.id, row.deviceId))
        .limit(1)
        .for('update');
      const [session] = await tx
        .select()
        .from(chargingSessions)
        .where(
          and(
            eq(chargingSessions.id, row.id),
            eq(chargingSessions.status, 'active'),
            lt(chargingSessions.lastProviderUpdateAt, staleBefore),
          ),
        )
        .limit(1);
      if (session === undefined || session.lastProviderUpdateAt === null) {
        return null;
      }

      const transition = closeChargingSession(
        {
          startTime: session.startTime,
          startBatteryLevel: numericOrNull(session.startBatteryLevel),
          endBatteryLevel: numericOrNull(session.endBatteryLevel),
          batteryCapacityKwh: numericOrNull(session.batteryCapacityKwh),
          lastProviderUpdateAt: session.lastProviderUpdateAt,
        },
        {
          endTime: session.lastProviderUpdateAt,
          endBatteryLevel: numericOrNull(session.endBatteryLevel),
          batteryCapacityKwh: numericOrNull(session.batteryCapacityKwh),
          electricityPricePerKwh: input.electricityPricePerKwh,
        },
      );
      await tx
        .update(chargingSessions)
        .set({
          status: transition.status,
          endTime: transition.endTime,
          energyDeliveredKwh: transition.energyDeliveredKwh.toFixed(4),
          energyMethod: transition.energyMethod,
          electricityPrice:
            transition.electricityPrice === null
              ? null
              : transition.electricityPrice.toFixed(4),
          totalCost:
            transition.totalCost === null
              ? null
              : transition.totalCost.toFixed(4),
          updatedAt: now,
        })
        .where(eq(chargingSessions.id, session.id));

      const event =
        transition.status === 'completed'
          ? await queueChargingSessionEvent(tx, session.id)
          : null;
      return { status: transition.status, event };
    });
    if (outcome === null) {
      continue;
    }
    closed += 1;
    if (outcome.event?.status === 'queued') {
      queued += 1;
    }
    log.info('charging_session.closed_stale', {
      chargingSessionId: row.id,
      status: outcome.status,
      event: outcome.event?.status ?? 'none',
    });
  }
  return { closed, queued };
}
