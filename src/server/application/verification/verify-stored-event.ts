import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApplicationError } from '@/server/application/application-error';
import {
  computeRecordHash,
  recomputeEventRecord,
} from '@/server/application/telemetry/device-event-record';
import {
  verifyDeviceEvent,
  type ChainObservation,
  type RecordEvidence,
  type VerificationCheck,
  type VerificationPolicy,
  type Verdict,
} from '@/server/application/verification/verify-device-event';
import { getServerEnv } from '@/server/config/env';
import {
  createDeviceEventChainReader,
  type DeviceEventChainReader,
} from '@/server/infrastructure/blockchain/device-event-chain-reader';
import { resolveTrustedWriters } from '@/server/infrastructure/blockchain/trusted-writers';
import type {
  Database,
  DatabaseExecutor,
} from '@/server/infrastructure/db/client';
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
import {
  deviceEvents,
  devices,
  eventVerifications,
  outboxEvents,
} from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'verify-stored-event' });

export const VERIFY_DEVICE_EVENT_JOB = 'VERIFY_DEVICE_EVENT';

/** Give an anchor a little depth before its first independent check. */
const FIRST_VERIFICATION_DELAY_MS = 30_000;

/** A stored 'pending' verdict is re-queued by the sweep after this. */
const PENDING_RECHECK_MS = 10 * 60 * 1000;
/** Backoff after a verify job exhausts its attempts: 15 min, 30 min, … 24 h. */
const FAILED_JOB_BACKOFF_BASE_MS = 15 * 60 * 1000;
const FAILED_JOB_BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
/** Finished verify jobs are kept this long, then pruned. */
const FINISHED_JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type StoredVerification = {
  deviceEventId: string;
  verdict: Verdict;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
  checkedBy: string;
  checkedAt: Date;
};

export function verificationPolicyFromEnv(): VerificationPolicy {
  const env = getServerEnv();
  return {
    requiredConfirmations: BigInt(env.ARC_REQUIRED_CONFIRMATIONS),
    trustedWriters: resolveTrustedWriters(env),
    maxAnchorDelaySeconds: env.VERIFICATION_MAX_ANCHOR_DELAY_HOURS * 3600,
    clockSkewSeconds: 300,
  };
}

/** Queue the independent check of a freshly confirmed event. */
export async function enqueueEventVerification(
  db: DatabaseExecutor,
  deviceEventId: string,
  delayMs = FIRST_VERIFICATION_DELAY_MS,
): Promise<void> {
  await enqueueOutboxEvent(db, {
    aggregateType: 'device_event',
    aggregateId: deviceEventId,
    eventType: VERIFY_DEVICE_EVENT_JOB,
    payload: { deviceEventId },
    availableAt: new Date(Date.now() + delayMs),
  });
}

type DeviceEventRow = typeof deviceEvents.$inferSelect;

async function recordEvidenceFor(
  db: DatabaseExecutor,
  event: DeviceEventRow,
): Promise<RecordEvidence> {
  if (event.payloadVersion !== 2) {
    return { kind: 'none' };
  }
  if (event.recordSalt === null || event.recordJson === null) {
    // A v2 payload commits to a record; losing its salt or snapshot is a
    // failure to show, not a reason to skip the check.
    return {
      kind: 'commitment',
      recomputedHash: null,
      problem: 'the record salt or snapshot is missing',
    };
  }
  const recomputed = await recomputeEventRecord(db, {
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    snapshotJson: event.recordJson,
  });
  return {
    kind: 'commitment',
    recomputedHash:
      recomputed.status === 'ok'
        ? computeRecordHash(event.recordSalt, recomputed.recordJson)
        : null,
    problem:
      recomputed.status === 'ok'
        ? null
        : recomputed.status === 'source_missing'
          ? 'the source record was deleted'
          : 'the stored snapshot is unreadable',
  };
}

/** Verdict for an event that has no anchor to check yet. */
function unanchoredResult(event: DeviceEventRow): {
  verdict: Verdict;
  checks: VerificationCheck[];
} {
  if (event.status === 'failed') {
    return {
      verdict: 'unverified',
      checks: [
        {
          id: 'anchor_exists',
          status: 'fail',
          detail: 'Publishing failed; this record was never anchored.',
        },
      ],
    };
  }
  return {
    verdict: 'pending',
    checks: [
      {
        id: 'anchor_exists',
        status: 'pending',
        detail: `Not anchored yet (status: ${event.status}).`,
      },
    ],
  };
}

/**
 * A failed read is not a verdict: surface it so the caller retries (worker)
 * or shows "try again" (pages), and nothing is recorded.
 */
export async function readChain<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    log.warn('device_event.chain_read_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw new ApplicationError(
      'VERIFICATION_UNAVAILABLE',
      'The Arc RPC could not be read; no verdict was recorded. Try again shortly.',
    );
  }
}

/**
 * Records are checked only on the chain and contract they were anchored on.
 * After a network or contract change, older records keep their last verdict
 * instead of being "disproved" by reading the wrong chain.
 */
function assertSameDeployment(event: DeviceEventRow, chainId: bigint): void {
  const contract = getServerEnv().DEVICE_NFT_CONTRACT_ADDRESS?.toLowerCase();
  const sameChain = event.chainId === null || event.chainId === chainId;
  const sameContract =
    contract !== undefined && event.contractAddress?.toLowerCase() === contract;
  if (!sameChain || !sameContract) {
    throw new ApplicationError(
      'VERIFICATION_UNAVAILABLE',
      `This record was anchored on chain ${event.chainId ?? 'unknown'} (contract ${event.contractAddress ?? 'unknown'}), which this server does not read.`,
    );
  }
}

/**
 * Independently re-checks one stored event against the chain and records
 * the outcome. Reads the chain by block (see DeviceEventChainReader), never
 * trusting the publisher's own receipt check. Throws on RPC failure so the
 * caller can retry; never records a verdict it could not compute.
 */
export async function verifyStoredDeviceEvent(input: {
  db: Database;
  deviceEventId: string;
  checkedBy: string;
  readerOverride?: DeviceEventChainReader;
  policyOverride?: VerificationPolicy;
}): Promise<StoredVerification> {
  const { db } = input;
  const [event] = await db
    .select()
    .from(deviceEvents)
    .where(eq(deviceEvents.id, input.deviceEventId))
    .limit(1);
  if (event === undefined) {
    throw new Error(`Device event not found: ${input.deviceEventId}`);
  }

  let verdict: Verdict;
  let checks: VerificationCheck[];
  let evidence: Record<string, unknown>;
  let rpcHost: string | null = null;

  if (
    event.status !== 'confirmed' ||
    event.transactionHash === null ||
    event.blockNumber === null ||
    event.tokenId === null ||
    event.contractAddress === null
  ) {
    ({ verdict, checks } = unanchoredResult(event));
    evidence = {};
  } else {
    const reader = input.readerOverride ?? createDeviceEventChainReader();
    rpcHost = reader.rpcHost;
    assertSameDeployment(event, reader.chainId);
    const tokenId = BigInt(event.tokenId);
    const { blockNumber, contractAddress } = event;
    const [latestBlockNumber, block, logs] = await readChain(() =>
      Promise.all([
        reader.latestBlockNumber(),
        reader.readBlock(blockNumber),
        reader.readDeviceEventLogs({
          contractAddress,
          fromBlock: blockNumber,
          toBlock: blockNumber,
          tokenId,
        }),
      ]),
    );
    const [device] = await db
      .select({ nftMintedAt: devices.nftMintedAt })
      .from(devices)
      .where(eq(devices.id, event.deviceId))
      .limit(1);
    const observation: ChainObservation = {
      latestBlockNumber,
      block:
        block === null
          ? null
          : { number: block.number, timestamp: block.timestamp },
      transactionSender: block?.senderOf(event.transactionHash) ?? null,
      logs: logs.filter(
        (entry) =>
          entry.transactionHash.toLowerCase() ===
          event.transactionHash?.toLowerCase(),
      ),
    };
    const result = verifyDeviceEvent(
      {
        contractAddress: event.contractAddress,
        transactionHash: event.transactionHash,
        blockNumber: event.blockNumber,
        tokenId,
        eventType: event.eventType,
        payloadHash: event.payloadHash,
        payloadJson: event.payloadJson,
        earliestAnchorAt: device?.nftMintedAt ?? null,
        record: await recordEvidenceFor(db, event),
      },
      observation,
      input.policyOverride ?? verificationPolicyFromEnv(),
    );
    verdict = result.verdict;
    checks = result.checks;
    evidence = {
      ...result.evidence,
      chainId: reader.chainId.toString(),
      contractAddress: event.contractAddress,
      transactionHash: event.transactionHash,
      payloadVersion: event.payloadVersion,
    };
  }

  const checkedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(eventVerifications).values({
      deviceEventId: event.id,
      verdict,
      checks,
      evidence,
      checkedBy: input.checkedBy,
      rpcHost,
      checkedAt,
    });
    await tx
      .update(deviceEvents)
      .set({
        verificationStatus: verdict,
        lastVerifiedAt: checkedAt,
        verificationAttempts: 0,
        // A 'pending' verdict is normally finished by its own job; this
        // only lets the sweep pick it up if that job was lost.
        verificationNextCheckAt:
          verdict === 'pending'
            ? new Date(checkedAt.getTime() + PENDING_RECHECK_MS)
            : null,
      })
      .where(eq(deviceEvents.id, event.id));
  });
  log.info('device_event.verified', {
    deviceEventId: event.id,
    verdict,
    checkedBy: input.checkedBy,
  });

  return {
    deviceEventId: event.id,
    verdict,
    checks,
    evidence,
    checkedBy: input.checkedBy,
    checkedAt,
  };
}

const storedVerdictSchema = z.enum([
  'pending',
  'verified',
  'verified_with_warnings',
  'unverified',
]);

const storedChecksSchema = z.array(
  z.object({
    id: z.enum([
      'anchor_exists',
      'finality',
      'authorized_writer',
      'device_and_type',
      'content_hash',
      'stored_payload',
      'record_commitment',
      'anchor_timeliness',
    ]),
    status: z.enum(['pass', 'fail', 'warn', 'pending', 'skip']),
    detail: z.string(),
  }),
);

/** Latest stored verification of an event, if any (validated on read). */
export async function latestVerification(
  db: Database,
  deviceEventId: string,
): Promise<StoredVerification | null> {
  const [last] = await db
    .select()
    .from(eventVerifications)
    .where(eq(eventVerifications.deviceEventId, deviceEventId))
    .orderBy(desc(eventVerifications.checkedAt))
    .limit(1);
  if (last === undefined) {
    return null;
  }
  const verdict = storedVerdictSchema.safeParse(last.verdict);
  const checks = storedChecksSchema.safeParse(last.checks);
  if (!verdict.success || !checks.success) {
    return null;
  }
  return {
    deviceEventId,
    verdict: verdict.data,
    checks: checks.data,
    evidence: last.evidence,
    checkedBy: last.checkedBy,
    checkedAt: last.checkedAt,
  };
}

/** SQL twin of assertSameDeployment, for the backfill sweep. */
function sameDeploymentFilter() {
  const env = getServerEnv();
  const contract = env.DEVICE_NFT_CONTRACT_ADDRESS?.toLowerCase() ?? '';
  return and(
    or(
      isNull(deviceEvents.chainId),
      eq(deviceEvents.chainId, BigInt(env.ARC_CHAIN_ID)),
    ),
    sql`lower(${deviceEvents.contractAddress}) = ${contract}`,
  );
}

/**
 * Queues a verify job for confirmed records still awaiting a verdict
 * ('unchecked', or a 'pending' whose job was lost) whose backoff is due.
 * One statement; records that already have an active job are skipped by
 * the outbox's partial unique index.
 */
export async function enqueueDueVerifications(
  db: Database,
  input: { now?: Date; limit?: number } = {},
): Promise<number> {
  const now = input.now ?? new Date();
  const inserted = await db.execute<{ id: string }>(sql`
    insert into ${outboxEvents}
      (aggregate_type, aggregate_id, event_type, payload, available_at)
    select 'device_event', ${deviceEvents.id}::text, ${VERIFY_DEVICE_EVENT_JOB},
      jsonb_build_object('deviceEventId', ${deviceEvents.id}::text),
      ${now.toISOString()}::timestamptz
    from ${deviceEvents}
    where ${and(
      eq(deviceEvents.status, 'confirmed'),
      inArray(deviceEvents.verificationStatus, ['unchecked', 'pending']),
      or(
        isNull(deviceEvents.verificationNextCheckAt),
        lte(deviceEvents.verificationNextCheckAt, now),
      ),
      sameDeploymentFilter(),
    )}
    order by ${deviceEvents.verificationNextCheckAt} asc nulls first,
      ${deviceEvents.confirmedAt} asc
    limit ${input.limit ?? 100}
    on conflict do nothing
    returning id
  `);
  return Array.from(inserted).length;
}

/**
 * A verify job ran out of attempts (RPC down, history unavailable…): back
 * off this record so the sweep does not re-queue it every minute.
 */
export async function markVerificationJobFailed(
  db: Database,
  deviceEventId: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .select({ attempts: deviceEvents.verificationAttempts })
    .from(deviceEvents)
    .where(eq(deviceEvents.id, deviceEventId))
    .limit(1);
  if (row === undefined) {
    return;
  }
  const attempts = row.attempts + 1;
  const backoffMs = Math.min(
    FAILED_JOB_BACKOFF_BASE_MS * 2 ** Math.min(row.attempts, 10),
    FAILED_JOB_BACKOFF_MAX_MS,
  );
  await db
    .update(deviceEvents)
    .set({
      verificationAttempts: Math.min(attempts, 1000),
      verificationNextCheckAt: new Date(now.getTime() + backoffMs),
    })
    .where(eq(deviceEvents.id, deviceEventId));
}

/**
 * Re-check these records soon (admin "Verify all"): runs in the worker,
 * never inside the request. An already-queued job is moved to now.
 */
export async function requestVerificationNow(
  db: Database,
  deviceEventIds: readonly string[],
): Promise<number> {
  if (deviceEventIds.length === 0) {
    return 0;
  }
  const now = new Date();
  const ids = [...deviceEventIds];
  await db.transaction(async (tx) => {
    await tx
      .update(deviceEvents)
      .set({ verificationAttempts: 0, verificationNextCheckAt: null })
      .where(inArray(deviceEvents.id, ids));
    await tx
      .update(outboxEvents)
      .set({ availableAt: now })
      .where(
        and(
          eq(outboxEvents.eventType, VERIFY_DEVICE_EVENT_JOB),
          eq(outboxEvents.status, 'pending'),
          inArray(outboxEvents.aggregateId, ids),
        ),
      );
    for (const id of ids) {
      await enqueueEventVerification(tx, id, 0);
    }
  });
  return ids.length;
}

/** Deletes finished verify jobs past retention (bounded per call). */
export async function pruneFinishedVerificationJobs(
  db: Database,
  now: Date = new Date(),
  limit = 1000,
): Promise<number> {
  const before = new Date(now.getTime() - FINISHED_JOB_RETENTION_MS);
  const deleted = await db.execute<{ id: string }>(sql`
    delete from ${outboxEvents}
    where ${outboxEvents.id} in (
      select ${outboxEvents.id} from ${outboxEvents}
      where ${and(
        eq(outboxEvents.eventType, VERIFY_DEVICE_EVENT_JOB),
        inArray(outboxEvents.status, ['completed', 'failed']),
        lt(outboxEvents.processedAt, before),
      )}
      limit ${limit}
    )
    returning id
  `);
  return Array.from(deleted).length;
}

/** Latest verification of each event, in one query (validated on read). */
export async function latestVerificationsFor(
  db: Database,
  deviceEventIds: readonly string[],
): Promise<Map<string, StoredVerification>> {
  const result = new Map<string, StoredVerification>();
  if (deviceEventIds.length === 0) {
    return result;
  }
  const rows = await db
    .selectDistinctOn([eventVerifications.deviceEventId])
    .from(eventVerifications)
    .where(inArray(eventVerifications.deviceEventId, [...deviceEventIds]))
    .orderBy(
      eventVerifications.deviceEventId,
      desc(eventVerifications.checkedAt),
    );
  for (const row of rows) {
    const verdict = storedVerdictSchema.safeParse(row.verdict);
    const checks = storedChecksSchema.safeParse(row.checks);
    if (verdict.success && checks.success) {
      result.set(row.deviceEventId, {
        deviceEventId: row.deviceEventId,
        verdict: verdict.data,
        checks: checks.data,
        evidence: row.evidence,
        checkedBy: row.checkedBy,
        checkedAt: row.checkedAt,
      });
    }
  }
  return result;
}
