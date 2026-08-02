import { eq, sql } from 'drizzle-orm';

import type {
  OutboxEventRecord,
  OutboxRepository,
} from '@/server/domain/shared/ports';

import type { Database } from '../client';
import { outboxEvents } from '../schema';

function mapOutbox(row: typeof outboxEvents.$inferSelect): OutboxEventRecord {
  return {
    id: row.id,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    eventType: row.eventType,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attemptCount,
    availableAt: row.availableAt,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    processedAt: row.processedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

type RawOutboxRow = {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  attempt_count: number;
  available_at: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  processed_at: Date | string | null;
  last_error: string | null;
  created_at: Date | string;
};

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function mapRawOutbox(row: RawOutboxRow): OutboxEventRecord {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    availableAt: toDate(row.available_at) ?? new Date(0),
    lockedAt: toDate(row.locked_at),
    lockedBy: row.locked_by,
    processedAt: toDate(row.processed_at),
    lastError: row.last_error,
    createdAt: toDate(row.created_at) ?? new Date(0),
  };
}

/**
 * PostgreSQL transactional outbox repository.
 *
 * Claim uses `FOR UPDATE SKIP LOCKED` so multiple workers can process safely.
 */
export function createOutboxRepository(db: Database): OutboxRepository {
  return {
    async enqueue(input) {
      const [row] = await db
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
        .returning();

      if (row === undefined) {
        throw new Error('Failed to enqueue outbox event');
      }

      return mapOutbox(row);
    },

    async claimNext(input) {
      const result = await db.execute(sql`
        with candidates as (
          select id
          from outbox_events
          where status in ('pending', 'failed')
            and available_at <= now()
            and (
              locked_at is null
              or locked_at < now() - interval '5 minutes'
            )
          order by available_at asc, created_at asc
          for update skip locked
          limit ${input.limit}
        )
        update outbox_events as o
        set
          status = 'processing',
          locked_at = now(),
          locked_by = ${input.workerId},
          attempt_count = o.attempt_count + 1
        from candidates
        where o.id = candidates.id
        returning
          o.id,
          o.aggregate_type,
          o.aggregate_id,
          o.event_type,
          o.payload,
          o.status,
          o.attempt_count,
          o.available_at,
          o.locked_at,
          o.locked_by,
          o.processed_at,
          o.last_error,
          o.created_at
      `);

      const rows = Array.from(result as unknown as RawOutboxRow[]);
      return rows.map(mapRawOutbox);
    },

    async markCompleted(id) {
      await db
        .update(outboxEvents)
        .set({
          status: 'completed',
          processedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        })
        .where(eq(outboxEvents.id, id));
    },

    async markFailed(input) {
      await db
        .update(outboxEvents)
        .set({
          status: input.deadLetter ? 'dead_letter' : 'failed',
          lastError: input.error,
          lockedAt: null,
          lockedBy: null,
          ...(input.retryAt !== null ? { availableAt: input.retryAt } : {}),
        })
        .where(eq(outboxEvents.id, input.id));
    },
  };
}
