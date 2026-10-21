import { eq } from 'drizzle-orm';
import { keccak256, stringToHex } from 'viem';
import { z } from 'zod';

import { ApplicationError } from '@/server/application/application-error';
import { DEVICE_EVENT_TYPES } from '@/server/application/telemetry/device-event-payloads';
import {
  verifyDeviceEvent,
  type VerificationCheck,
  type Verdict,
} from '@/server/application/verification/verify-device-event';
import {
  latestVerification,
  verificationPolicyFromEnv,
  verifyStoredDeviceEvent,
} from '@/server/application/verification/verify-stored-event';
import { defaultArcRpcUrl } from '@/config/arc-network';
import { getServerEnv } from '@/server/config/env';
import {
  createDeviceEventChainReader,
  type DeviceEventChainReader,
} from '@/server/infrastructure/blockchain/device-event-chain-reader';
import type { Database } from '@/server/infrastructure/db/client';
import { deviceEvents } from '@/server/infrastructure/db/schema';

/** A public result is reused for this long before re-reading the chain. */
export const PUBLIC_VERIFICATION_CACHE_MS = 5 * 60 * 1000;

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export const transactionHashSchema = z.string().regex(TX_HASH);

/** Everything here is already public on-chain. Never the salt or record. */
export type PublicEventRecord = {
  id: string;
  kind: 'charging_completed' | 'daily_mileage' | 'device_event';
  eventType: number;
  occurredAt: string;
  publishStatus: string;
  chainId: string | null;
  contractAddress: string | null;
  tokenId: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  payloadVersion: number;
  payloadJson: string;
  payloadHash: string;
};

export type PublicVerificationResult = {
  verdict: Verdict;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
  checkedAt: string;
  checkedBy: string;
};

export type PublicVerification = {
  record: PublicEventRecord;
  verification: PublicVerificationResult | null;
  reproduce: { rpcUrl: string | null; command: string };
};

function kindOf(eventType: number): PublicEventRecord['kind'] {
  if (eventType === DEVICE_EVENT_TYPES.CHARGING_COMPLETED) {
    return 'charging_completed';
  }
  if (eventType === DEVICE_EVENT_TYPES.TRIP_COMPLETED) {
    return 'daily_mileage';
  }
  return 'device_event';
}

type DeviceEventRow = typeof deviceEvents.$inferSelect;

function toPublicRecord(row: DeviceEventRow): PublicEventRecord {
  return {
    id: row.id,
    kind: kindOf(row.eventType),
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    publishStatus: row.status,
    chainId: row.chainId?.toString() ?? null,
    contractAddress: row.contractAddress,
    tokenId: row.tokenId,
    transactionHash: row.transactionHash,
    blockNumber: row.blockNumber?.toString() ?? null,
    payloadVersion: row.payloadVersion,
    payloadJson: row.payloadJson,
    payloadHash: row.payloadHash,
  };
}

/** How anyone can repeat the check without this server. */
function reproduceFor(record: PublicEventRecord) {
  const chainId = record.chainId ?? getServerEnv().ARC_CHAIN_ID;
  const rpcUrl = defaultArcRpcUrl(chainId);
  const command =
    record.transactionHash === null || record.blockNumber === null
      ? 'Not anchored yet.'
      : [
          'pnpm verify:standalone --',
          `--rpc ${rpcUrl ?? '<arc-rpc-url>'}`,
          `--contract ${record.contractAddress ?? '<contract>'}`,
          `--tx ${record.transactionHash}`,
          `--block ${record.blockNumber}`,
          `--payload '<payload json>'`,
        ].join(' ');
  return { rpcUrl, command };
}

function toPublicResult(
  stored: Awaited<ReturnType<typeof latestVerification>>,
): PublicVerificationResult | null {
  if (stored === null) {
    return null;
  }
  return {
    verdict: stored.verdict,
    checks: stored.checks,
    evidence: stored.evidence,
    checkedAt: stored.checkedAt.toISOString(),
    checkedBy: stored.checkedBy,
  };
}

async function findEvent(
  db: Database,
  input: { deviceEventId?: string; transactionHash?: string },
): Promise<DeviceEventRow | null> {
  if (input.deviceEventId !== undefined) {
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.id, input.deviceEventId))
      .limit(1);
    return row ?? null;
  }
  if (input.transactionHash !== undefined) {
    const [row] = await db
      .select()
      .from(deviceEvents)
      .where(
        eq(deviceEvents.transactionHash, input.transactionHash.toLowerCase()),
      )
      .limit(1);
    if (row !== undefined) {
      return row;
    }
    // Hashes are stored as the RPC returned them; try the exact input too.
    const [exact] = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.transactionHash, input.transactionHash))
      .limit(1);
    return exact ?? null;
  }
  return null;
}

/**
 * Public view of one of our records and its latest verification. Re-reads
 * the chain when the stored result is older than the cache window and the
 * caller asked for a fresh check (route rate-limits that).
 */
export async function getPublicEventVerification(
  db: Database,
  input: {
    deviceEventId?: string;
    transactionHash?: string;
    /** Re-read the chain if the stored result is older than the cache. */
    refresh: boolean;
    /** Re-read the chain even if the stored result is fresh. */
    force?: boolean;
    readerOverride?: DeviceEventChainReader;
  },
): Promise<PublicVerification | null> {
  const row = await findEvent(db, input);
  if (row === null) {
    return null;
  }
  let stored = await latestVerification(db, row.id);
  const stale =
    stored === null ||
    Date.now() - stored.checkedAt.getTime() > PUBLIC_VERIFICATION_CACHE_MS;
  const shouldCheck = input.force === true || (input.refresh && stale);
  if (shouldCheck && row.status === 'confirmed') {
    stored = await verifyStoredDeviceEvent({
      db,
      deviceEventId: row.id,
      checkedBy: 'public',
      ...(input.readerOverride !== undefined
        ? { readerOverride: input.readerOverride }
        : {}),
    });
  }
  const record = toPublicRecord(row);
  return {
    record,
    verification: toPublicResult(stored),
    reproduce: reproduceFor(record),
  };
}

export const verifyClaimInputSchema = z
  .object({
    transactionHash: transactionHashSchema,
    blockNumber: z.coerce.bigint().positive().optional(),
    /** The record you hold, exactly as published (the event's data). */
    payloadJson: z.string().min(2).max(8192),
  })
  .strict();

export type VerifyClaimInput = z.infer<typeof verifyClaimInputSchema>;

export type ClaimVerification = {
  /** Set when the transaction is one of this app's stored records. */
  deviceEventId: string | null;
  verdict: Verdict;
  checks: VerificationCheck[];
  evidence: Record<string, unknown>;
};

/**
 * "I hold this payload and this transaction — is it genuine?" Works for any
 * DeviceEvent on our contract, even one this app has no record of: checks
 * the anchor, writer, finality and that the supplied payload is exactly the
 * anchored bytes. Nothing is stored.
 */
export async function verifyClaim(
  db: Database,
  input: VerifyClaimInput,
  readerOverride?: DeviceEventChainReader,
): Promise<ClaimVerification> {
  const env = getServerEnv();
  const contractAddress = env.DEVICE_NFT_CONTRACT_ADDRESS;
  if (contractAddress === undefined) {
    throw new ApplicationError(
      'VERIFICATION_UNAVAILABLE',
      'Verification is not configured on this server.',
    );
  }
  const reader = readerOverride ?? createDeviceEventChainReader();
  const known = await findEvent(db, { transactionHash: input.transactionHash });
  const blockNumber =
    input.blockNumber ??
    known?.blockNumber ??
    (await reader.findTransactionBlock(input.transactionHash));
  if (blockNumber === null) {
    throw new ApplicationError(
      'BLOCK_NUMBER_REQUIRED',
      'This RPC no longer indexes that transaction hash. Include its blockNumber.',
    );
  }

  const [latestBlockNumber, block, logs] = await Promise.all([
    reader.latestBlockNumber(),
    reader.readBlock(blockNumber),
    reader.readDeviceEventLogs({
      contractAddress,
      fromBlock: blockNumber,
      toBlock: blockNumber,
    }),
  ]);
  const txLogs = logs.filter(
    (entry) =>
      entry.transactionHash.toLowerCase() ===
      input.transactionHash.toLowerCase(),
  );
  const anchored = txLogs[0];
  const result = verifyDeviceEvent(
    {
      contractAddress,
      transactionHash: input.transactionHash,
      blockNumber,
      // Identity comes from the anchor itself; we're checking the content.
      tokenId: anchored?.tokenId ?? -1n,
      eventType: anchored?.eventType ?? -1,
      payloadHash: keccak256(stringToHex(input.payloadJson)),
      payloadJson: input.payloadJson,
      occurredAt: known?.occurredAt ?? null,
      // The private record is not available to a third party.
      record: { kind: 'none' },
    },
    {
      latestBlockNumber,
      block:
        block === null
          ? null
          : { number: block.number, timestamp: block.timestamp },
      transactionSender: block?.senderOf(input.transactionHash) ?? null,
      logs: txLogs,
    },
    verificationPolicyFromEnv(),
  );
  return {
    deviceEventId: known?.id ?? null,
    verdict: result.verdict,
    checks: result.checks,
    evidence: {
      ...result.evidence,
      chainId: reader.chainId.toString(),
      contractAddress,
      transactionHash: input.transactionHash,
      tokenId: anchored?.tokenId.toString() ?? null,
      eventType: anchored?.eventType ?? null,
    },
  };
}
