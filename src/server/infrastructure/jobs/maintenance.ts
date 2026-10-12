import { closeStaleChargingSessions } from '@/server/application/telemetry/close-stale-charging-sessions';
import { finalizeDueOdometerDays } from '@/server/application/telemetry/finalize-odometer-days';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'maintenance' });

/** How often the worker runs the time-series sweeps. */
export const MAINTENANCE_INTERVAL_MS = 60_000;

/**
 * Periodic, idempotent time-series upkeep: finalize finished UTC days
 * (queuing their daily TRIP_COMPLETED events) and close charging sessions
 * Enode never reported as stopped. Safe to run from several workers.
 */
export async function runTelemetryMaintenance(
  db: Database,
  now: Date = new Date(),
): Promise<void> {
  const days = await finalizeDueOdometerDays(db, now);
  const sessions = await closeStaleChargingSessions(db, {
    now,
    electricityPricePerKwh: getServerEnv().ELECTRICITY_PRICE_USD_PER_KWH,
  });
  if (days.finalized > 0 || sessions.closed > 0) {
    log.info('maintenance.ran', {
      daysFinalized: days.finalized,
      dayEventsQueued: days.queued,
      staleSessionsClosed: sessions.closed,
      sessionEventsQueued: sessions.queued,
    });
  }
}
