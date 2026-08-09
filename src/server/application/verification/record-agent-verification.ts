import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import { agentVerificationResults } from '@/server/infrastructure/db/schema';

export const AGENT_VERIFICATION_STATUSES = [
  'VERIFIED',
  'TX_MISSING',
  'TX_FAILED',
  'HASH_MISMATCH',
  'ERROR',
  'PENDING_ONCHAIN',
] as const;

export type AgentVerificationStatus =
  (typeof AGENT_VERIFICATION_STATUSES)[number];

export type RecordAgentVerificationInput = {
  readonly telemetryRecordId: string;
  readonly paymentTransactionHash: string;
  readonly status: AgentVerificationStatus;
  readonly receiptFound: boolean;
  readonly receiptSuccess: boolean;
  readonly contentHashExpected: string;
  readonly contentHashComputed: string;
  readonly contentHashMatched: boolean;
  readonly details?: Record<string, unknown>;
};

/**
 * Persists agent-reported Arc + content-hash checks.
 * This is not server-authoritative chain verification.
 */
export async function recordAgentVerification(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  payload: RecordAgentVerificationInput;
}): Promise<{
  readonly id: string | undefined;
  readonly status: AgentVerificationStatus;
  readonly source: 'agent_reported';
}> {
  const verifiedAt = new Date();
  const paymentTransactionHash =
    input.payload.paymentTransactionHash.toLowerCase();

  const [row] = await input.db
    .insert(agentVerificationResults)
    .values({
      principalId: input.principal.principalId,
      telemetryRecordId: input.payload.telemetryRecordId,
      paymentTransactionHash,
      status: input.payload.status,
      receiptFound: input.payload.receiptFound,
      receiptSuccess: input.payload.receiptSuccess,
      contentHashExpected: input.payload.contentHashExpected,
      contentHashComputed: input.payload.contentHashComputed,
      contentHashMatched: input.payload.contentHashMatched,
      details: input.payload.details,
      verifiedAt,
    })
    .onConflictDoUpdate({
      target: [
        agentVerificationResults.principalId,
        agentVerificationResults.telemetryRecordId,
        agentVerificationResults.paymentTransactionHash,
      ],
      set: {
        status: input.payload.status,
        receiptFound: input.payload.receiptFound,
        receiptSuccess: input.payload.receiptSuccess,
        contentHashComputed: input.payload.contentHashComputed,
        contentHashMatched: input.payload.contentHashMatched,
        details: input.payload.details,
        verifiedAt,
      },
    })
    .returning();

  return {
    id: row?.id,
    status: input.payload.status,
    source: 'agent_reported',
  };
}
