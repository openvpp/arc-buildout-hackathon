import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';

import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { devices, outboxEvents } from '@/server/infrastructure/db/schema';
import { decideOutboxFollowUp } from '@/server/infrastructure/jobs/outbox-follow-up';
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

async function applyFollowUp(
  db: Database,
  event: OutboxRow,
  deviceId: string,
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
    if (followUp.markDeviceFailed) {
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
  if (event.eventType !== 'MINT_DEVICE_NFT') {
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
  const deviceId = event.payload['deviceId'];
  if (typeof deviceId !== 'string') {
    await db
      .update(outboxEvents)
      .set({
        status: 'failed',
        lockedAt: null,
        lastError: 'missing deviceId',
        processedAt: new Date(),
      })
      .where(eq(outboxEvents.id, event.id));
    return;
  }

  const env = getServerEnv();
  try {
    const result = await mintDeviceNftIfNeeded({ db, deviceId });
    log.info('worker.mint_job_result', { deviceId, status: result.status });
    const followUp = decideOutboxFollowUp({
      outcome: result.status,
      attempts: event.attempts,
      maxAttempts: env.WORKER_MAX_ATTEMPTS,
      hasInFlightTransaction: false,
      errorMessage: null,
    });
    await applyFollowUp(db, event, deviceId, followUp);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hasInFlightTransaction = await deviceHasInFlightMint(db, deviceId);
    log.error('worker.mint_job_failed', {
      deviceId,
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
    await applyFollowUp(db, event, deviceId, followUp);
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
