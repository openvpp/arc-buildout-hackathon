import { closeStaleChargingSessions } from '@/server/application/telemetry/close-stale-charging-sessions';
import { finalizeDueOdometerDays } from '@/server/application/telemetry/finalize-odometer-days';
import { scanChainForward } from '@/server/application/verification/chain-event-index';
import { enqueueUncheckedVerifications } from '@/server/application/verification/verify-stored-event';
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
  // Confirmed events never independently checked (e.g. from before M3).
  const verificationsQueued = await enqueueUncheckedVerifications(db);
  // Index new on-chain DeviceEvents (any writer). An RPC failure here must
  // not stop the sweeps above; it resumes from its cursor next minute.
  try {
    await scanChainForward(db);
  } catch (error) {
    log.warn('maintenance.chain_scan_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
  if (days.finalized > 0 || sessions.closed > 0 || verificationsQueued > 0) {
    log.info('maintenance.ran', {
      daysFinalized: days.finalized,
      dayEventsQueued: days.queued,
      staleSessionsClosed: sessions.closed,
      sessionEventsQueued: sessions.queued,
      verificationsQueued,
    });
  }
}
