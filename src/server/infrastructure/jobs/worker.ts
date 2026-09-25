import { and, asc, eq, lte } from 'drizzle-orm';

import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { outboxEvents } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'worker' });

type OutboxRow = typeof outboxEvents.$inferSelect;

async function claimNextEvent(db: Database): Promise<OutboxRow | null> {
  const [row] = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.status, 'pending'),
        lte(outboxEvents.availableAt, new Date()),
      ),
    )
    .orderBy(asc(outboxEvents.availableAt))
    .limit(1);
  if (row === undefined) {
    return null;
  }
  const [claimed] = await db
    .update(outboxEvents)
    .set({ status: 'processing' })
    .where(and(eq(outboxEvents.id, row.id), eq(outboxEvents.status, 'pending')))
    .returning();
  return claimed ?? null;
}

async function handleEvent(db: Database, event: OutboxRow): Promise<void> {
  if (event.eventType !== 'MINT_DEVICE_NFT') {
    log.warn('worker.unknown_event_type', {
      eventType: event.eventType,
      id: event.id,
    });
    await db
      .update(outboxEvents)
      .set({ status: 'completed', processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));
    return;
  }
  const deviceId = event.payload['deviceId'];
  if (typeof deviceId !== 'string') {
    await db
      .update(outboxEvents)
      .set({
        status: 'failed',
        lastError: 'missing deviceId',
        processedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));
    return;
  }

  try {
    const result = await mintDeviceNftIfNeeded({ db, deviceId });
    log.info('worker.mint_job_result', { deviceId, status: result.status });
    await db
      .update(outboxEvents)
      .set({ status: 'completed', processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));
  } catch (error) {
    const env = getServerEnv();
    const attempts = event.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    log.error('worker.mint_job_failed', {
      deviceId,
      attempts,
      errorMessage: message,
    });
    if (attempts >= env.WORKER_MAX_ATTEMPTS) {
      await db
        .update(outboxEvents)
        .set({
          status: 'failed',
          attempts,
          lastError: message,
          processedAt: new Date(),
        })
        .where(eq(outboxEvents.id, event.id));
    } else {
      const backoffMs = Math.min(2 ** attempts * 1000, 60_000);
      await db
        .update(outboxEvents)
        .set({
          status: 'pending',
          attempts,
          lastError: message,
          availableAt: new Date(Date.now() + backoffMs),
        })
        .where(eq(outboxEvents.id, event.id));
    }
  }
}

/** Runs one poll cycle: claim and process up to one pending outbox event. */
export async function runWorkerCycle(db: Database): Promise<boolean> {
  const event = await claimNextEvent(db);
  if (event === null) {
    return false;
  }
  await handleEvent(db, event);
  return true;
}
