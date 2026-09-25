import type { Database } from '@/server/infrastructure/db/client';
import { outboxEvents } from '@/server/infrastructure/db/schema';

export async function enqueueOutboxEvent(
  db: Database,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(outboxEvents).values({
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    payload: input.payload,
  });
}
