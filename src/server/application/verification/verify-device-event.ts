/**
 * Pure verification of one device event against what was observed on-chain.
 * No I/O: the caller reads the chain and the database, this decides.
 *
 * Verified means: anchored in the stated block by our DeviceNFT contract,
 * sent by an authorized writer, final, for the right token and event type,
 * byte-identical to the stored payload, (v2) the full off-chain record is
 * unchanged, and it was anchored soon after the activity it describes.
 * It does NOT mean the underlying measurement is true — only that the record
 * is tamper-evident, attributable and timely.
 */

import type {
  CheckStatus,
  Verdict,
  VerificationCheckId,
} from '@/lib/verification/vocabulary';

export type { CheckStatus, Verdict, VerificationCheckId };

export type VerificationCheck = {
  id: VerificationCheckId;
  status: CheckStatus;
  detail: string;
};

/** One `DeviceEvent` log as read from the chain. */
export type ObservedDeviceEventLog = {
  contractAddress: string;
  transactionHash: string;
  logIndex: number;
  tokenId: bigint;
  eventType: number;
  /** keccak256 of the log's `data` bytes. */
  dataHash: string;
  /** The log's `data` decoded as UTF-8 (the published payload). */
  dataUtf8: string | null;
};

export type ChainObservation = {
  latestBlockNumber: bigint;
  /** Null when the block could not be read. */
  block: { number: bigint; timestamp: bigint } | null;
  /** Sender of the anchoring transaction; null if not found in the block. */
  transactionSender: string | null;
  /** DeviceEvent logs of the anchoring transaction in that block. */
  logs: ObservedDeviceEventLog[];
};

export type RecordEvidence =
  | { kind: 'none' }
  | {
      kind: 'commitment';
      /**
       * keccak256(salt:recordJson) recomputed from today's database. It is
       * compared with the recordHash inside the anchored bytes, never with
       * a database copy of it.
       */
      recomputedHash: string | null;
      /** Why recomputation failed, when it did. */
      problem: string | null;
    };

export type ExpectedEvent = {
  contractAddress: string;
  transactionHash: string;
  blockNumber: bigint;
  /** Null when the caller has no independent expectation (not compared). */
  tokenId: bigint | null;
  eventType: number | null;
  payloadHash: string;
  /** Stored payload text; null when verifying a third party's claim. */
  payloadJson: string | null;
  /**
   * The anchor could not have been written before this (the DeviceNFT's
   * mint): a record held while its device was being minted is measured for
   * lateness from here. The activity time itself always comes from the
   * anchored payload.
   */
  earliestAnchorAt: Date | null;
  record: RecordEvidence;
};

export type VerificationPolicy = {
  requiredConfirmations: bigint;
  /** Lowercased writer addresses whose anchors we vouch for. */
  trustedWriters: readonly string[];
  /** Anchors later than this after the activity are flagged. */
  maxAnchorDelaySeconds: number;
  /** Allowed clock skew when an anchor predates its activity. */
  clockSkewSeconds: number;
};

export type VerificationResult = {
  verdict: Verdict;
  checks: VerificationCheck[];
  evidence: {
    blockNumber: string | null;
    blockTimestamp: string | null;
    confirmations: string | null;
    transactionSender: string | null;
    logIndex: number | null;
    onChainDataHash: string | null;
  };
};

const lower = (value: string) => value.toLowerCase();

/**
 * The fields the verifier needs from the anchored bytes. Only on-chain data
 * is trusted for these: a database copy could have been edited.
 */
export function readAnchoredPayload(dataUtf8: string | null): {
  recordHash: string | null;
  endTime: Date | null;
} {
  if (dataUtf8 === null) {
    return { recordHash: null, endTime: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataUtf8);
  } catch {
    return { recordHash: null, endTime: null };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { recordHash: null, endTime: null };
  }
  const fields = parsed as Record<string, unknown>;
  const recordHash =
    typeof fields.recordHash === 'string' ? fields.recordHash : null;
  const endMs =
    typeof fields.endTime === 'string' ? Date.parse(fields.endTime) : NaN;
  return {
    recordHash,
    endTime: Number.isNaN(endMs) ? null : new Date(endMs),
  };
}

export function verifyDeviceEvent(
  expected: ExpectedEvent,
  observed: ChainObservation,
  policy: VerificationPolicy,
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const add = (id: VerificationCheckId, status: CheckStatus, detail: string) =>
    checks.push({ id, status, detail });

  // 1. The anchor exists: a DeviceEvent from our contract in that tx/block.
  const fromContract = observed.logs.filter(
    (entry) =>
      lower(entry.contractAddress) === lower(expected.contractAddress) &&
      lower(entry.transactionHash) === lower(expected.transactionHash),
  );
  // A transaction can carry several DeviceEvents: prefer the one whose bytes
  // are this record, then the expected device/type, then the first.
  const match =
    fromContract.find(
      (entry) => lower(entry.dataHash) === lower(expected.payloadHash),
    ) ??
    fromContract.find(
      (entry) =>
        entry.tokenId === expected.tokenId &&
        entry.eventType === expected.eventType,
    ) ??
    fromContract[0];
  const anchored = readAnchoredPayload(match?.dataUtf8 ?? null);
  if (observed.block === null) {
    add(
      'anchor_exists',
      'fail',
      `Block ${expected.blockNumber} could not be read.`,
    );
  } else if (match === undefined) {
    add(
      'anchor_exists',
      'fail',
      `No DeviceEvent from ${expected.contractAddress} in tx ${expected.transactionHash} at block ${expected.blockNumber}.`,
    );
  } else {
    add(
      'anchor_exists',
      'pass',
      `DeviceEvent found in block ${observed.block.number} (log ${match.logIndex}).`,
    );
  }

  // 2. Finality.
  const confirmations =
    observed.block === null
      ? null
      : observed.latestBlockNumber - observed.block.number + 1n;
  if (confirmations === null) {
    add('finality', 'skip', 'No block to measure confirmations from.');
  } else if (confirmations < policy.requiredConfirmations) {
    add(
      'finality',
      'pending',
      `${confirmations} of ${policy.requiredConfirmations} confirmations.`,
    );
  } else {
    add('finality', 'pass', `${confirmations} confirmations.`);
  }

  // 3. Authorized writer: the contract lets any UPDATER_ROLE holder write.
  if (observed.transactionSender === null) {
    add(
      'authorized_writer',
      'fail',
      'Anchoring transaction sender not found in the block.',
    );
  } else if (
    policy.trustedWriters.includes(lower(observed.transactionSender))
  ) {
    add(
      'authorized_writer',
      'pass',
      `Sent by authorized writer ${observed.transactionSender}.`,
    );
  } else {
    add(
      'authorized_writer',
      'fail',
      `Sent by ${observed.transactionSender}, which is not an authorized writer.`,
    );
  }

  // 4. Right device and event type (each compared only when expected).
  if (match === undefined) {
    add('device_and_type', 'skip', 'No anchor to compare.');
  } else if (expected.tokenId === null && expected.eventType === null) {
    add(
      'device_and_type',
      'skip',
      `Anchored for token ${match.tokenId}, event type ${match.eventType}; no expected device was given, so it was not compared.`,
    );
  } else if (
    (expected.tokenId === null || match.tokenId === expected.tokenId) &&
    (expected.eventType === null || match.eventType === expected.eventType)
  ) {
    add(
      'device_and_type',
      'pass',
      `Token ${match.tokenId}, event type ${match.eventType}.`,
    );
  } else {
    add(
      'device_and_type',
      'fail',
      `On-chain token ${match.tokenId} / type ${match.eventType}, expected ${expected.tokenId ?? 'any'} / ${expected.eventType ?? 'any'}.`,
    );
  }

  // 5. Content hash: on-chain bytes hash to the stored payload hash.
  if (match === undefined) {
    add('content_hash', 'skip', 'No anchor to compare.');
  } else if (lower(match.dataHash) === lower(expected.payloadHash)) {
    add('content_hash', 'pass', `keccak256(data) = ${match.dataHash}.`);
  } else {
    add(
      'content_hash',
      'fail',
      `On-chain data hashes to ${match.dataHash}, record says ${expected.payloadHash}.`,
    );
  }

  // 6. The stored payload still produces the stored hash (and equals the
  // on-chain bytes).
  if (expected.payloadJson === null) {
    add('stored_payload', 'skip', 'No stored payload supplied.');
  } else if (match?.dataUtf8 !== undefined && match.dataUtf8 !== null) {
    add(
      'stored_payload',
      match.dataUtf8 === expected.payloadJson ? 'pass' : 'fail',
      match.dataUtf8 === expected.payloadJson
        ? 'Stored payload is byte-identical to the on-chain data.'
        : 'Stored payload differs from the on-chain data.',
    );
  } else {
    add('stored_payload', 'skip', 'No on-chain data to compare.');
  }

  // 7. Full off-chain record (payload version 2).
  if (expected.record.kind === 'none') {
    add(
      'record_commitment',
      'skip',
      'Payload version 1: no record commitment; only the public payload is verifiable.',
    );
  } else if (match === undefined) {
    add('record_commitment', 'skip', 'No anchor to compare.');
  } else if (anchored.recordHash === null) {
    add(
      'record_commitment',
      'fail',
      'The record claims a recordHash commitment, but the anchored payload has none.',
    );
  } else if (expected.record.recomputedHash === null) {
    add(
      'record_commitment',
      'fail',
      `Off-chain record could not be rebuilt: ${expected.record.problem ?? 'unknown'}.`,
    );
  } else if (
    lower(expected.record.recomputedHash) === lower(anchored.recordHash)
  ) {
    add(
      'record_commitment',
      'pass',
      'Full off-chain record matches the anchored recordHash.',
    );
  } else {
    add(
      'record_commitment',
      'fail',
      'Off-chain record changed since it was anchored (recordHash mismatch).',
    );
  }

  // 8. Timeliness: anchored soon after (and not before) the activity, as
  // stated by the anchored payload's endTime.
  if (observed.block === null || anchored.endTime === null) {
    add(
      'anchor_timeliness',
      'skip',
      observed.block === null
        ? 'Block time unknown.'
        : 'The anchored payload states no activity end time.',
    );
  } else {
    const anchoredAt = Number(observed.block.timestamp);
    const activityEnd = Math.floor(anchored.endTime.getTime() / 1000);
    const delay = anchoredAt - activityEnd;
    // A record queued before its DeviceNFT existed could not be anchored
    // until the mint; lateness counts from whichever came last.
    const mintedAt =
      expected.earliestAnchorAt === null
        ? null
        : Math.floor(expected.earliestAnchorAt.getTime() / 1000);
    const heldForMint = mintedAt !== null && mintedAt > activityEnd;
    const lateness = anchoredAt - (heldForMint ? mintedAt : activityEnd);
    if (delay < -policy.clockSkewSeconds) {
      add(
        'anchor_timeliness',
        'fail',
        `Anchored ${Math.abs(delay)} s before the activity it claims to record.`,
      );
    } else if (lateness > policy.maxAnchorDelaySeconds) {
      add(
        'anchor_timeliness',
        'warn',
        heldForMint
          ? `Anchored ${formatDuration(lateness)} after the DeviceNFT was minted (limit ${formatDuration(policy.maxAnchorDelaySeconds)}).`
          : `Anchored ${formatDuration(delay)} after the activity (limit ${formatDuration(policy.maxAnchorDelaySeconds)}).`,
      );
    } else {
      add(
        'anchor_timeliness',
        'pass',
        heldForMint
          ? `Anchored ${formatDuration(Math.max(delay, 0))} after the activity, held until the DeviceNFT was minted.`
          : `Anchored ${formatDuration(Math.max(delay, 0))} after the activity.`,
      );
    }
  }

  const statuses = checks.map((check) => check.status);
  const verdict: Verdict = statuses.includes('fail')
    ? 'unverified'
    : statuses.includes('pending')
      ? 'pending'
      : statuses.includes('warn')
        ? 'verified_with_warnings'
        : 'verified';

  return {
    verdict,
    checks,
    evidence: {
      blockNumber: observed.block?.number.toString() ?? null,
      blockTimestamp:
        observed.block === null
          ? null
          : new Date(Number(observed.block.timestamp) * 1000).toISOString(),
      confirmations: confirmations?.toString() ?? null,
      transactionSender: observed.transactionSender,
      logIndex: match?.logIndex ?? null,
      onChainDataHash: match?.dataHash ?? null,
    },
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
}

/**
 * Daily-series completeness for one device. A UTC day with raw odometer
 * readings must end up either published on-chain or explained (finalized
 * but intentionally unpublished, e.g. under 0.1 mi, or still open). A day
 * with readings that is neither is a gap: something expected was not
 * anchored. Silent days (no readings) are not gaps — their distance carries
 * into the next day with readings.
 */
export function findDailySeriesGaps(input: {
  datesWithReadings: readonly string[];
  publishedDates: readonly string[];
  explainedDates: readonly string[];
}): string[] {
  const covered = new Set([...input.publishedDates, ...input.explainedDates]);
  return [...new Set(input.datesWithReadings)]
    .filter((day) => !covered.has(day))
    .sort();
}
