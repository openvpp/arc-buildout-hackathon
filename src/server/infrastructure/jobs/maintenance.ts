import { closeStaleChargingSessions } from '@/server/application/telemetry/close-stale-charging-sessions';
import { finalizeDueOdometerDays } from '@/server/application/telemetry/finalize-odometer-days';
import { scanChainForward } from '@/server/application/verification/chain-event-index';
import {
  enqueueDueVerifications,
  pruneFinishedVerificationJobs,
} from '@/server/application/verification/verify-stored-event';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'maintenance' });

/** How often the worker runs the time-series sweeps. */
export const MAINTENANCE_INTERVAL_MS = 60_000;

/** How often the worker indexes new on-chain DeviceEvents. */
export const CHAIN_SCAN_INTERVAL_MS = 60_000;

/** A scan stops starting new RPC requests after this long. */
const CHAIN_SCAN_BUDGET_MS = 15_000;

/**
 * Periodic, idempotent time-series upkeep: finalize finished UTC days
 * (queuing their daily TRIP_COMPLETED events), close charging sessions
 * Enode never reported as stopped, and queue due verification checks.
 * Database only (no RPC), so it never stalls the job loop. Safe to run
 * from several workers.
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
  // Confirmed events still awaiting a verdict whose backoff is due.
  const verificationsQueued = await enqueueDueVerifications(db, { now });
  const jobsPruned = await pruneFinishedVerificationJobs(db, now);
  if (
    days.finalized > 0 ||
    sessions.closed > 0 ||
    verificationsQueued > 0 ||
    jobsPruned > 0
  ) {
    log.info('maintenance.ran', {
      daysFinalized: days.finalized,
      dayEventsQueued: days.queued,
      staleSessionsClosed: sessions.closed,
      sessionEventsQueued: sessions.queued,
      verificationsQueued,
      verifyJobsPruned: jobsPruned,
    });
  }
}

/**
 * Index new on-chain DeviceEvents (any writer), within a time budget so a
 * slow verifier RPC cannot hold up mint and publish jobs. An RPC failure is
 * logged; the scan resumes from its cursor next time.
 */
export async function runChainIndexing(db: Database): Promise<void> {
  try {
    await scanChainForward(db, undefined, Date.now() + CHAIN_SCAN_BUDGET_MS);
  } catch (error) {
    log.warn('maintenance.chain_scan_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
