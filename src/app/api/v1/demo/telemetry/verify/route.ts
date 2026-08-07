import { z } from 'zod';

import { bindDashboardOwnerWallet } from '@/server/application/onboarding/bind-dashboard-owner';
import { verifyAndStoreSettlementEvidence } from '@/server/application/verification/verify-settlement-evidence';
import { getContainer } from '@/server/bootstrap/container';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    deviceId: z.string().uuid(),
    telemetryRecordId: z.string().uuid(),
    paymentTransactionHash: z.string().min(1),
  })
  .strict();

/**
 * Dashboard BFF: after unlock, run independent Arc + content-hash verification
 * and persist into agent_verification_results (increments Verified count).
 */
export const POST = createRouteHandler(async (request, context) => {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid verification request.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const identity = await verifyWeb3AuthIdentity({
    authorizationHeader: request.headers.get('authorization'),
    claimedWalletAddress: parsed.data.walletAddress,
  });

  const container = getContainer();
  const bound = await bindDashboardOwnerWallet(container.db, identity);

  const result = await verifyAndStoreSettlementEvidence({
    db: container.db,
    principalId: bound.principalId,
    walletAddress: parsed.data.walletAddress,
    deviceId: parsed.data.deviceId,
    telemetryRecordId: parsed.data.telemetryRecordId,
    paymentTransactionHash: parsed.data.paymentTransactionHash,
  });

  return jsonOk(
    {
      status: result.status,
      verificationId: result.verificationId,
      receiptFound: result.receiptFound,
      receiptSuccess: result.receiptSuccess,
      contentHashMatched: result.contentHashMatched,
      contentHashExpected: result.contentHashExpected,
      contentHashComputed: result.contentHashComputed,
    },
    context.requestId,
    { status: 201 },
  );
});
