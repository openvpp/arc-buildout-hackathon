import { getContainer } from '@/server/bootstrap/container';
import { closeDb } from '@/server/infrastructure/db/client';
import { foundationJobHandlers } from '@/server/infrastructure/jobs/handlers';
import { createWorkerFromEnv } from '@/server/infrastructure/jobs/worker';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

/**
 * Background worker entry point.
 *
 * Reuses the same domain/infrastructure modules as the Next.js API process.
 * Long-running / retryable work belongs here, not inside Route Handlers.
 */
async function main(): Promise<void> {
  const log = createServerLogger({ component: 'worker-main' });
  const container = getContainer();

  log.info('worker.starting');

  const { stop } = await createWorkerFromEnv({
    outbox: container.outbox,
    handlers: foundationJobHandlers,
  });

  const shutdown = async (signal: string) => {
    log.info('worker.shutdown_signal', { signal });
    await stop();
    await closeDb();
    log.info('worker.exited');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  log.info('worker.started');
}

main().catch((error: unknown) => {
  const log = createServerLogger({ component: 'worker-main' });
  log.error('worker.crashed', {
    errorMessage: error instanceof Error ? error.message : 'unknown',
  });
  process.exit(1);
});
