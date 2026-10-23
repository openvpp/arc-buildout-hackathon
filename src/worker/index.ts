import { getServerEnv } from '@/server/config/env';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
import {
  CHAIN_SCAN_INTERVAL_MS,
  MAINTENANCE_INTERVAL_MS,
  runChainIndexing,
  runTelemetryMaintenance,
} from '@/server/infrastructure/jobs/maintenance';
import { runWorkerCycle } from '@/server/infrastructure/jobs/worker';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'worker-main' });

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

async function main(): Promise<void> {
  const env = getServerEnv();
  const db = getDb();
  log.info('worker.started', { workerId: env.WORKER_ID });

  let lastMaintenanceAt = 0;
  let lastChainScanAt = 0;
  while (!stopping) {
    // Each interval counts from when the previous run finished, so a slow
    // run cannot make the next one start immediately after.
    if (Date.now() - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
      try {
        await runTelemetryMaintenance(db);
      } catch (error) {
        log.error('worker.maintenance_failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } finally {
        lastMaintenanceAt = Date.now();
      }
    }
    if (Date.now() - lastChainScanAt >= CHAIN_SCAN_INTERVAL_MS) {
      await runChainIndexing(db);
      lastChainScanAt = Date.now();
    }
    try {
      const didWork = await runWorkerCycle(db);
      if (!didWork) {
        await sleepUnlessStopping(env.WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      log.error('worker.cycle_failed', {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await sleepUnlessStopping(env.WORKER_POLL_INTERVAL_MS);
    }
  }
  await closeDb();
  log.info('worker.stopped', { workerId: env.WORKER_ID });
}

function sleepUnlessStopping(ms: number): Promise<void> {
  const step = 200;
  return new Promise((resolve) => {
    let remaining = ms;
    const tick = () => {
      if (stopping || remaining <= 0) {
        resolve();
        return;
      }
      const wait = Math.min(step, remaining);
      remaining -= wait;
      setTimeout(tick, wait);
    };
    tick();
  });
}

main().catch((error: unknown) => {
  log.error('worker.crashed', {
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
