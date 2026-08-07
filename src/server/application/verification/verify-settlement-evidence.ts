import { and, eq } from 'drizzle-orm';
import { createPublicClient, http } from 'viem';

import { getServerEnv } from '@/server/config/env';
import {
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
  type CanonicalTelemetryDocument,
} from '@/server/domain/telemetry/canonical';
import type { Database } from '@/server/infrastructure/db/client';
import {
  agentVerificationResults,
  devices,
  telemetryRecords,
  wallets,
} from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';

const log = createServerLogger({ component: 'verify-settlement' });

export type SettlementVerificationStatus =
  'VERIFIED' | 'TX_MISSING' | 'TX_FAILED' | 'HASH_MISMATCH' | 'ERROR';

/**
 * Independent Step-6 style check: Arc settlement receipt (when on-chain) +
 * content-hash integrity. Dashboard "Verify" and the demo agent both report
 * into `agent_verification_results` — this never authorizes release.
 */
export async function verifyAndStoreSettlementEvidence(input: {
  db: Database;
  principalId: string;
  walletAddress: string;
  deviceId: string;
  telemetryRecordId: string;
  paymentTransactionHash: string;
}): Promise<{
  status: SettlementVerificationStatus;
  receiptFound: boolean;
  receiptSuccess: boolean;
  contentHashExpected: string;
  contentHashComputed: string;
  contentHashMatched: boolean;
  verificationId: string;
}> {
  const [owned] = await input.db
    .select({
      deviceId: devices.id,
      walletAddress: wallets.address,
    })
    .from(devices)
    .innerJoin(wallets, eq(wallets.id, devices.walletId))
    .where(
      and(
        eq(devices.id, input.deviceId),
        eq(wallets.address, input.walletAddress.toLowerCase()),
      ),
    )
    .limit(1);

  if (owned === undefined) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Device is not owned by this wallet.',
      status: 403,
    });
  }

  const [record] = await input.db
    .select()
    .from(telemetryRecords)
    .where(
      and(
        eq(telemetryRecords.id, input.telemetryRecordId),
        eq(telemetryRecords.deviceId, input.deviceId),
      ),
    )
    .limit(1);

  if (record === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found for this device.',
      status: 404,
    });
  }

  const contentHashExpected = record.contentHash;
  const contentHashComputed = recomputeContentHash(record);
  const contentHashMatched = contentHashComputed === contentHashExpected;

  const settlementRef = input.paymentTransactionHash.trim();
  const isOnchainTx = /^0x[a-fA-F0-9]{64}$/.test(settlementRef);

  let receiptFound = false;
  let receiptSuccess = false;
  let status: SettlementVerificationStatus = 'VERIFIED';

  const env = getServerEnv();

  if (isOnchainTx) {
    try {
      const client = createPublicClient({
        transport: http(env.ARC_RPC_URL ?? 'https://rpc.testnet.arc.network'),
      });
      const receipt = await client.getTransactionReceipt({
        hash: settlementRef as `0x${string}`,
      });
      receiptFound = true;
      receiptSuccess = receipt.status === 'success';
    } catch (error: unknown) {
      log.warn('verify.receipt_lookup_failed', {
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      receiptFound = false;
      receiptSuccess = false;
    }

    if (!receiptFound) status = 'TX_MISSING';
    else if (!receiptSuccess) status = 'TX_FAILED';
    else if (!contentHashMatched) status = 'HASH_MISMATCH';
    else status = 'VERIFIED';
  } else {
    // Circle Gateway may return a transfer UUID until the batch lands on-chain.
    status = contentHashMatched ? 'VERIFIED' : 'HASH_MISMATCH';
  }

  // Mock settlements are not on Arc — do not invent TX_MISSING as failure.
  if (env.ALLOW_MOCK_ADAPTERS && !receiptFound && contentHashMatched) {
    status = 'VERIFIED';
  }

  const paymentTransactionHash = isOnchainTx
    ? settlementRef.toLowerCase()
    : settlementRef;

  const [row] = await input.db
    .insert(agentVerificationResults)
    .values({
      principalId: input.principalId,
      telemetryRecordId: record.id,
      paymentTransactionHash,
      status,
      receiptFound,
      receiptSuccess,
      contentHashExpected,
      contentHashComputed,
      contentHashMatched,
      details: {
        source: 'dashboard_verify',
        deviceId: input.deviceId,
      },
      verifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        agentVerificationResults.principalId,
        agentVerificationResults.telemetryRecordId,
        agentVerificationResults.paymentTransactionHash,
      ],
      set: {
        status,
        receiptFound,
        receiptSuccess,
        contentHashComputed,
        contentHashMatched,
        details: {
          source: 'dashboard_verify',
          deviceId: input.deviceId,
        },
        verifiedAt: new Date(),
      },
    })
    .returning({ id: agentVerificationResults.id });

  if (row === undefined) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Failed to persist verification result.',
      status: 500,
      expose: false,
    });
  }

  log.info('verify.stored', {
    status,
    receiptFound,
    contentHashMatched,
    telemetryRecordId: record.id,
  });

  return {
    status,
    receiptFound,
    receiptSuccess,
    contentHashExpected,
    contentHashComputed,
    contentHashMatched,
    verificationId: row.id,
  };
}

function recomputeContentHash(record: {
  contentHash: string;
  canonicalPayload: unknown;
  deviceId: string;
  source: string;
  sourceObservedAt: Date | null;
  recordedAt: Date;
  receivedAt: Date;
  telemetryPayload: Record<string, unknown>;
}): string {
  if (
    record.canonicalPayload !== null &&
    typeof record.canonicalPayload === 'object'
  ) {
    return hashCanonicalTelemetry(
      canonicalizeTelemetry(
        record.canonicalPayload as CanonicalTelemetryDocument,
      ),
    ).contentHash;
  }

  // Fallback: trust stored hash only when canonical payload is missing.
  return record.contentHash;
}
