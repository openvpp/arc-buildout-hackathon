import { and, desc, eq } from 'drizzle-orm';

import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import {
  agentVerificationResults,
  devices,
  principalWallets,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { ApiError } from '@/server/transport/http/api-error';

export type AgentVerificationSnapshot = {
  readonly telemetryRecordId: string;
  readonly contentHash: string;
  readonly verification: {
    readonly status: string;
    readonly source: 'agent_reported';
    readonly paymentTransactionHash: string;
    readonly receiptFound: boolean;
    readonly receiptSuccess: boolean;
    readonly contentHashMatched: boolean;
    readonly contentHashExpected: string;
    readonly contentHashComputed: string;
    readonly verifiedAt: string;
  } | null;
};

export async function getAgentVerification(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  telemetryRecordId: string;
}): Promise<AgentVerificationSnapshot> {
  const [record] = await input.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.id, input.telemetryRecordId))
    .limit(1);
  if (record === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found.',
      status: 404,
    });
  }

  const [device] = await input.db
    .select()
    .from(devices)
    .where(eq(devices.id, record.deviceId))
    .limit(1);
  if (device === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found.',
      status: 404,
    });
  }

  const [access] = await input.db
    .select()
    .from(principalWallets)
    .where(
      and(
        eq(principalWallets.principalId, input.principal.principalId),
        eq(principalWallets.walletId, device.walletId),
      ),
    )
    .limit(1);
  if (access === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found.',
      status: 404,
    });
  }

  const [verification] = await input.db
    .select()
    .from(agentVerificationResults)
    .where(
      and(
        eq(agentVerificationResults.principalId, input.principal.principalId),
        eq(agentVerificationResults.telemetryRecordId, input.telemetryRecordId),
      ),
    )
    .orderBy(desc(agentVerificationResults.verifiedAt))
    .limit(1);

  return {
    telemetryRecordId: input.telemetryRecordId,
    contentHash: record.contentHash,
    verification:
      verification === undefined
        ? null
        : {
            status: verification.status,
            source: 'agent_reported',
            paymentTransactionHash: verification.paymentTransactionHash,
            receiptFound: verification.receiptFound,
            receiptSuccess: verification.receiptSuccess,
            contentHashMatched: verification.contentHashMatched,
            contentHashExpected: verification.contentHashExpected,
            contentHashComputed: verification.contentHashComputed,
            verifiedAt: verification.verifiedAt.toISOString(),
          },
  };
}
