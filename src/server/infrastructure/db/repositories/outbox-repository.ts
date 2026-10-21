import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import { outboxEvents } from '@/server/infrastructure/db/schema';

export async function enqueueOutboxEvent(
  db: DatabaseExecutor,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
    /** Earliest time a worker may pick the job up (default: now). */
    availableAt?: Date;
  },
): Promise<void> {
  await db
    .insert(outboxEvents)
    .values({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      payload: input.payload,
      ...(input.availableAt !== undefined
        ? { availableAt: input.availableAt }
        : {}),
    })
    .onConflictDoNothing();
}
