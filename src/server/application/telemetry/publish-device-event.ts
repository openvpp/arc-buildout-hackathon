import { and, eq, isNull, lt, or } from 'drizzle-orm';

import {
  createDeviceEventRecorder,
  type DeviceEventRecorder,
} from '@/server/infrastructure/blockchain/device-event-recorder';
import type { Database } from '@/server/infrastructure/db/client';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'publish-device-event' });

/** A `pending` claim older than this is stale and may be reclaimed (crashed worker). */
const EVENT_CLAIM_LEASE_MS = 10 * 60 * 1000;

export type PublishDeviceEventResult =
  | { status: 'confirmed'; transactionHash: string }
  | { status: 'already_confirmed' }
  // Terminal; nothing more to do for this row.
  | { status: 'already_failed' }
  // The device has no confirmed DeviceNFT yet — retry later, never drop.
  | { status: 'waiting_for_mint' }
  | { status: 'busy' }
  | { status: 'unconfigured' };

type DeviceEventRow = typeof deviceEvents.$inferSelect;

async function markConfirmed(
  db: Database,
  eventId: string,
  input: { transactionHash: string; blockNumber: bigint; tokenId: bigint },
): Promise<void> {
  await db
    .update(deviceEvents)
    .set({
      status: 'confirmed',
      tokenId: input.tokenId.toString(),
      transactionHash: input.transactionHash,
      blockNumber: input.blockNumber,
      confirmedAt: new Date(),
      claimedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(deviceEvents.id, eventId));
}

/** Drop a reverted tx hash so the next attempt broadcasts afresh. */
async function clearRevertedTransaction(
  db: Database,
  event: DeviceEventRow,
  transactionHash: string,
): Promise<void> {
  await db
    .update(deviceEvents)
    .set({ transactionHash: null, blockNumber: null, updatedAt: new Date() })
    .where(
      and(
        eq(deviceEvents.id, event.id),
        eq(deviceEvents.transactionHash, transactionHash),
      ),
    );
}

/**
 * Publishes one queued device_events row via `recordDeviceEvent`.
 * Mirrors the mint pipeline: claim-before-send so only one worker holds the
 * row; the tx hash is persisted at broadcast, before confirmation, so a
 * crash reconciles against the in-flight tx instead of recording twice; the
 * row only becomes `confirmed` from a confirmed receipt carrying a
 * byte-identical DeviceEvent log. Runs from the worker, never in a request.
 */
export async function publishDeviceEvent(input: {
  db: Database;
  deviceEventId: string;
  /** Injectable for tests; defaults to the real Arc recorder. */
  recorderOverride?: DeviceEventRecorder | null;
}): Promise<PublishDeviceEventResult> {
  const { db, deviceEventId } = input;

  const [event] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.id, deviceEventId))
    .limit(1);
  if (event === undefined) {
    throw new Error(`Device event not found: ${deviceEventId}`);
  }
  if (event.status === 'confirmed') {
    return { status: 'already_confirmed' };
  }
  if (event.status === 'failed') {
    return { status: 'already_failed' };
  }

  const recorder =
    input.recorderOverride !== undefined
      ? input.recorderOverride
      : createDeviceEventRecorder();
  if (recorder === null) {
    return { status: 'unconfigured' };
  }

  const [device] = await db
    .select({
      nftTokenId: devices.nftTokenId,
      nftContractAddress: devices.nftContractAddress,
    })
    .from(devices)
    .where(eq(devices.id, event.deviceId))
    .limit(1);
  if (device === undefined) {
    throw new Error(`Device not found for event ${deviceEventId}`);
  }
  if (device.nftTokenId === null || device.nftTokenId.length === 0) {
    return { status: 'waiting_for_mint' };
  }
  // A token id is only meaningful on the contract that minted it.
  if (
    device.nftContractAddress !== null &&
    device.nftContractAddress.toLowerCase() !==
      recorder.contractAddress.toLowerCase()
  ) {
    throw new Error(
      `Device ${event.deviceId} was minted on a different contract than the configured one`,
    );
  }
  const tokenId = BigInt(device.nftTokenId);

  const now = new Date();
  const staleBoundary = new Date(now.getTime() - EVENT_CLAIM_LEASE_MS);
  const [claimed] = await db
    .update(deviceEvents)
    .set({ status: 'pending', claimedAt: now, updatedAt: now })
    .where(
      and(
        eq(deviceEvents.id, deviceEventId),
        or(
          eq(deviceEvents.status, 'queued'),
          and(
            eq(deviceEvents.status, 'pending'),
            or(
              isNull(deviceEvents.claimedAt),
              lt(deviceEvents.claimedAt, staleBoundary),
            ),
          ),
        ),
      ),
    )
    .returning();
  if (claimed === undefined) {
    return { status: 'busy' };
  }

  const expected = {
    tokenId,
    eventType: claimed.eventType,
    payloadHash: claimed.payloadHash,
  };

  if (claimed.transactionHash !== null) {
    const reconciled = await recorder.reconcileDeviceEvent({
      ...expected,
      transactionHash: claimed.transactionHash,
    });
    if (reconciled.outcome === 'confirmed') {
      await markConfirmed(db, claimed.id, {
        transactionHash: claimed.transactionHash,
        blockNumber: reconciled.blockNumber,
        tokenId,
      });
      log.info('device_event.reconciled', {
        deviceEventId,
        transactionHash: claimed.transactionHash,
      });
      return { status: 'confirmed', transactionHash: claimed.transactionHash };
    }
    if (reconciled.outcome === 'reverted') {
      await clearRevertedTransaction(db, claimed, claimed.transactionHash);
      log.warn('device_event.reconcile_reverted', {
        deviceEventId,
        transactionHash: claimed.transactionHash,
      });
    } else {
      await db
        .update(deviceEvents)
        .set({ claimedAt: null, updatedAt: new Date() })
        .where(eq(deviceEvents.id, claimed.id));
      throw new Error(
        `Device event transaction ${claimed.transactionHash} is not confirmed yet (${reconciled.outcome}).`,
      );
    }
  }

  const broadcast: { hash: string | null } = { hash: null };
  try {
    const result = await recorder.recordDeviceEvent({
      ...expected,
      payloadJson: claimed.payloadJson,
      onBroadcast: async (hash) => {
        broadcast.hash = hash;
        await db
          .update(deviceEvents)
          .set({
            transactionHash: hash,
            tokenId: device.nftTokenId,
            chainId: recorder.chainId,
            contractAddress: recorder.contractAddress,
            claimedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(deviceEvents.id, claimed.id));
      },
    });

    if (result.outcome === 'reverted') {
      await clearRevertedTransaction(db, claimed, result.transactionHash);
      throw new Error(
        `recordDeviceEvent transaction ${result.transactionHash} reverted`,
      );
    }

    await markConfirmed(db, claimed.id, { ...result, tokenId });
    log.info('device_event.confirmed', {
      deviceEventId,
      eventType: claimed.eventType,
      transactionHash: result.transactionHash,
    });
    return { status: 'confirmed', transactionHash: result.transactionHash };
  } catch (error) {
    // Release the claim so the retry can run immediately. A persisted tx
    // hash (status stays 'pending') is reconciled, never re-broadcast.
    const [current] = await db
      .select({ transactionHash: deviceEvents.transactionHash })
      .from(deviceEvents)
      .where(eq(deviceEvents.id, claimed.id))
      .limit(1);
    await db
      .update(deviceEvents)
      .set({
        status:
          current?.transactionHash === null ||
          current?.transactionHash === undefined
            ? 'queued'
            : 'pending',
        claimedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(deviceEvents.id, claimed.id));
    if (broadcast.hash !== null) {
      log.warn('device_event.errored_after_broadcast', {
        deviceEventId,
        transactionHash: broadcast.hash,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

/** True when the row has a broadcast tx that may still confirm. */
export async function deviceEventHasInFlightTransaction(
  db: Database,
  deviceEventId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      status: deviceEvents.status,
      transactionHash: deviceEvents.transactionHash,
    })
    .from(deviceEvents)
    .where(eq(deviceEvents.id, deviceEventId))
    .limit(1);
  return (
    row !== undefined &&
    row.status !== 'confirmed' &&
    row.transactionHash !== null
  );
}

/** Terminal failure: only when nothing is in flight (see worker follow-up). */
export async function markDeviceEventFailed(
  db: Database,
  deviceEventId: string,
): Promise<void> {
  await db
    .update(deviceEvents)
    .set({ status: 'failed', claimedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(deviceEvents.id, deviceEventId),
        isNull(deviceEvents.transactionHash),
        or(
          eq(deviceEvents.status, 'queued'),
          eq(deviceEvents.status, 'pending'),
        ),
      ),
    );
}
