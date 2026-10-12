import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';

import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import {
  deviceEventHasInFlightTransaction,
  markDeviceEventFailed,
  publishDeviceEvent,
} from '@/server/application/telemetry/publish-device-event';
import { RECORD_DEVICE_EVENT_JOB } from '@/server/application/telemetry/queue-device-event';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { devices, outboxEvents } from '@/server/infrastructure/db/schema';
import {
  decideOutboxFollowUp,
  type OutboxJobOutcome,
} from '@/server/infrastructure/jobs/outbox-follow-up';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'worker' });

/** A crashed worker's `processing` row becomes claimable again after this. */
const OUTBOX_LOCK_MS = 30 * 60 * 1000;

type OutboxRow = typeof outboxEvents.$inferSelect;

async function claimNextEvent(db: Database): Promise<OutboxRow | null> {
  return db.transaction(async (tx) => {
    const staleBefore = new Date(Date.now() - OUTBOX_LOCK_MS);
    await tx
      .update(outboxEvents)
      .set({ status: 'pending', lockedAt: null })
      .where(
        and(
          eq(outboxEvents.status, 'processing'),
          or(
            isNull(outboxEvents.lockedAt),
            lt(outboxEvents.lockedAt, staleBefore),
          ),
        ),
      );

    const [row] = await tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.status, 'pending'),
          lte(outboxEvents.availableAt, new Date()),
        ),
      )
      .orderBy(asc(outboxEvents.availableAt))
      .limit(1)
      .for('update', { skipLocked: true });
    if (row === undefined) {
      return null;
    }

    const [claimed] = await tx
      .update(outboxEvents)
      .set({ status: 'processing', lockedAt: new Date() })
      .where(
        and(eq(outboxEvents.id, row.id), eq(outboxEvents.status, 'pending')),
      )
      .returning();
    return claimed ?? null;
  });
}

async function deviceHasInFlightMint(
  db: Database,
  deviceId: string,
): Promise<boolean> {
  const [device] = await db
    .select({
      nftTransactionHash: devices.nftTransactionHash,
      nftTokenId: devices.nftTokenId,
    })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  return (
    device?.nftTransactionHash !== null &&
    device?.nftTransactionHash !== undefined &&
    device.nftTransactionHash.length > 0 &&
    (device.nftTokenId === null || device.nftTokenId.length === 0)
  );
}

type JobHandler = {
  /** Payload key holding the job's target id. */
  targetKey: string;
  run(db: Database, targetId: string): Promise<OutboxJobOutcome>;
  hasInFlightTransaction(db: Database, targetId: string): Promise<boolean>;
  markFailed(db: Database, targetId: string): Promise<void>;
};

const JOB_HANDLERS: Record<string, JobHandler> = {
  MINT_DEVICE_NFT: {
    targetKey: 'deviceId',
    async run(db, deviceId) {
      const result = await mintDeviceNftIfNeeded({ db, deviceId });
      return result.status;
    },
    hasInFlightTransaction: deviceHasInFlightMint,
    async markFailed(db, deviceId) {
      await db
        .update(devices)
        .set({
          mintStatus: 'failed',
          mintClaimedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(devices.id, deviceId),
            or(isNull(devices.nftTokenId), eq(devices.nftTokenId, '')),
            or(
              isNull(devices.nftTransactionHash),
              eq(devices.nftTransactionHash, ''),
            ),
          ),
        );
    },
  },
  [RECORD_DEVICE_EVENT_JOB]: {
    targetKey: 'deviceEventId',
    async run(db, deviceEventId) {
      const result = await publishDeviceEvent({ db, deviceEventId });
      return result.status;
    },
    hasInFlightTransaction: deviceEventHasInFlightTransaction,
    markFailed: markDeviceEventFailed,
  },
};

async function applyFollowUp(
  db: Database,
  event: OutboxRow,
  handler: JobHandler,
  targetId: string,
  followUp: ReturnType<typeof decideOutboxFollowUp>,
): Promise<void> {
  if (followUp.action === 'complete') {
    await db
      .update(outboxEvents)
      .set({ status: 'completed', lockedAt: null, processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));
    return;
  }
  if (followUp.action === 'fail') {
    await db
      .update(outboxEvents)
      .set({
        status: 'failed',
        lockedAt: null,
        attempts: followUp.attempts,
        lastError: followUp.lastError,
        processedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));
    if (followUp.markTargetFailed) {
      await handler.markFailed(db, targetId);
    }
    return;
  }
  await db
    .update(outboxEvents)
    .set({
      status: 'pending',
      lockedAt: null,
      attempts: followUp.attempts,
      lastError: followUp.lastError,
      availableAt: new Date(Date.now() + followUp.delayMs),
    })
    .where(eq(outboxEvents.id, event.id));
}

async function handleEvent(db: Database, event: OutboxRow): Promise<void> {
  const handler = JOB_HANDLERS[event.eventType];
  if (handler === undefined) {
    log.warn('worker.unknown_event_type', {
      eventType: event.eventType,
      id: event.id,
    });
    await db
      .update(outboxEvents)
      .set({ status: 'completed', lockedAt: null, processedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));
    return;
  }
  const targetId = event.payload[handler.targetKey];
  if (typeof targetId !== 'string') {
    await db
      .update(outboxEvents)
      .set({
        status: 'failed',
        lockedAt: null,
        lastError: `missing ${handler.targetKey}`,
        processedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));
    return;
  }

  const env = getServerEnv();
  try {
    const outcome = await handler.run(db, targetId);
    log.info('worker.job_result', {
      eventType: event.eventType,
      targetId,
      status: outcome,
    });
    const followUp = decideOutboxFollowUp({
      outcome,
      attempts: event.attempts,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      hasInFlightTransaction: false,
      errorMessage: null,
    });
    await applyFollowUp(db, event, handler, targetId, followUp);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hasInFlightTransaction = await handler.hasInFlightTransaction(
      db,
      targetId,
    );
    log.error('worker.job_failed', {
      eventType: event.eventType,
      targetId,
      attempts: event.attempts + 1,
      inFlight: hasInFlightTransaction,
      errorMessage: message,
    });
    const followUp = decideOutboxFollowUp({
      outcome: 'error',
      attempts: event.attempts,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      hasInFlightTransaction,
      errorMessage: message,
    });
    await applyFollowUp(db, event, handler, targetId, followUp);
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
