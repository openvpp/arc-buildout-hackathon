import { getServerEnv } from '@/server/config/env';
import type {
  OutboxEventRecord,
  OutboxRepository,
} from '@/server/domain/shared/ports';
import {
  createServerLogger,
  type ServerLogger,
} from '@/server/infrastructure/logging/logger';

export type JobHandler = (event: OutboxEventRecord) => Promise<void>;

export type WorkerOptions = {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly concurrency: number;
  readonly maxAttempts: number;
  readonly outbox: OutboxRepository;
  readonly handlers: Readonly<Record<string, JobHandler>>;
  readonly logger?: ServerLogger;
};

function computeBackoffMs(attemptCount: number): number {
  const base = Math.min(60_000, 500 * 2 ** Math.max(0, attemptCount - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

/**
 * PostgreSQL outbox worker loop with graceful shutdown.
 *
 * Handlers must be idempotent. Unknown event types are dead-lettered.
 */
export async function runWorker(options: WorkerOptions): Promise<{
  stop: () => Promise<void>;
}> {
  const log =
    options.logger ??
    createServerLogger({
      component: 'worker',
      workerId: options.workerId,
    });

  let running = true;
  let inFlight = 0;

  const tick = async (): Promise<void> => {
    if (!running) return;

    const available = options.concurrency - inFlight;
    if (available <= 0) return;

    const claimed = await options.outbox.claimNext({
      workerId: options.workerId,
      limit: available,
      lockDurationMs: 5 * 60_000,
    });

    await Promise.all(
      claimed.map(async (event) => {
        inFlight += 1;
        const jobLog = log.child({
          jobId: event.id,
          eventType: event.eventType,
          attemptCount: event.attemptCount,
        });

        try {
          const handler = options.handlers[event.eventType];
          if (handler === undefined) {
            jobLog.warn('job.unknown_type');
            await options.outbox.markFailed({
              id: event.id,
              error: `Unknown event type: ${event.eventType}`,
              retryAt: null,
              deadLetter: true,
            });
            return;
          }

          await handler(event);
          await options.outbox.markCompleted(event.id);
          jobLog.info('job.completed');
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'unknown job error';
          const deadLetter = event.attemptCount >= options.maxAttempts;
          const retryAt = deadLetter
            ? null
            : new Date(Date.now() + computeBackoffMs(event.attemptCount));

          jobLog.error('job.failed', {
            deadLetter,
            errorMessage: message,
          });

          await options.outbox.markFailed({
            id: event.id,
            error: message,
            retryAt,
            deadLetter,
          });
        } finally {
          inFlight -= 1;
        }
      }),
    );
  };

  const interval = setInterval(() => {
    void tick().catch((error: unknown) => {
      log.error('worker.tick_failed', {
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
    });
  }, options.pollIntervalMs);

  // Kick immediately.
  void tick().catch(() => undefined);

  return {
    async stop() {
      running = false;
      clearInterval(interval);
      const deadline = Date.now() + 10_000;
      while (inFlight > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      log.info('worker.stopped', { inFlight });
    },
  };
}

export function createWorkerFromEnv(input: {
  outbox: OutboxRepository;
  handlers: Readonly<Record<string, JobHandler>>;
}): Promise<{ stop: () => Promise<void> }> {
  const env = getServerEnv();
  return runWorker({
    workerId: env.WORKER_ID,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    concurrency: env.WORKER_CONCURRENCY,
    maxAttempts: env.WORKER_MAX_ATTEMPTS,
    outbox: input.outbox,
    handlers: input.handlers,
  });
}
