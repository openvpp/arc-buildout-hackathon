import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

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
  eventVerifications,
} from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'verify-stored-event' });

export const VERIFY_DEVICE_EVENT_JOB = 'VERIFY_DEVICE_EVENT';

/** Give an anchor a little depth before its first independent check. */
const FIRST_VERIFICATION_DELAY_MS = 30_000;

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
  if (
    event.payloadVersion !== 2 ||
    event.recordHash === null ||
    event.recordSalt === null ||
    event.recordJson === null
  ) {
    return { kind: 'none' };
  }
  const recomputed = await recomputeEventRecord(db, {
    sourceType: event.sourceType,
    sourceId: event.sourceId,
    snapshotJson: event.recordJson,
  });
  return {
    kind: 'commitment',
    committedHash: event.recordHash,
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
    const tokenId = BigInt(event.tokenId);
    const [latestBlockNumber, block, logs] = await Promise.all([
      reader.latestBlockNumber(),
      reader.readBlock(event.blockNumber),
      reader.readDeviceEventLogs({
        contractAddress: event.contractAddress,
        fromBlock: event.blockNumber,
        toBlock: event.blockNumber,
        tokenId,
      }),
    ]);
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
        occurredAt: event.occurredAt,
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
      .set({ verificationStatus: verdict, lastVerifiedAt: checkedAt })
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

/** Confirmed events never independently checked yet (bounded batch). */
export async function enqueueUncheckedVerifications(
  db: Database,
  limit = 100,
): Promise<number> {
  const rows = await db
    .select({ id: deviceEvents.id })
    .from(deviceEvents)
    .where(
      and(
        eq(deviceEvents.status, 'confirmed'),
        eq(deviceEvents.verificationStatus, 'unchecked'),
      ),
    )
    .orderBy(asc(deviceEvents.confirmedAt))
    .limit(limit);
  for (const row of rows) {
    await enqueueEventVerification(db, row.id, 0);
  }
  return rows.length;
}
