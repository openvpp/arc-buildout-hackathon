import { getServerEnv } from '@/server/config/env';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
import {
  MAINTENANCE_INTERVAL_MS,
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
  while (!stopping) {
    if (Date.now() - lastMaintenanceAt >= MAINTENANCE_INTERVAL_MS) {
      lastMaintenanceAt = Date.now();
      try {
        await runTelemetryMaintenance(db);
      } catch (error) {
        log.error('worker.maintenance_failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
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
