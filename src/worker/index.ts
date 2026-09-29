import { getServerEnv } from '@/server/config/env';
import { closeDb, getDb } from '@/server/infrastructure/db/client';
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

  while (!stopping) {
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
