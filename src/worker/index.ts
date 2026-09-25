import { getServerEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/db/client';
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
    const didWork = await runWorkerCycle(db);
    if (!didWork) {
      await new Promise((resolve) =>
        setTimeout(resolve, env.WORKER_POLL_INTERVAL_MS),
      );
    }
  }
  log.info('worker.stopped', { workerId: env.WORKER_ID });
}

main().catch((error: unknown) => {
  log.error('worker.crashed', {
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
