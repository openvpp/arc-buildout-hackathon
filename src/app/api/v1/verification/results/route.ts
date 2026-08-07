import { z } from 'zod';

import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { agentVerificationResults } from '@/server/infrastructure/db/schema';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    telemetryRecordId: z.string().uuid(),
    paymentTransactionHash: z.string().min(1),
    status: z.enum([
      'VERIFIED',
      'TX_MISSING',
      'TX_FAILED',
      'HASH_MISMATCH',
      'ERROR',
      'PENDING_ONCHAIN',
    ]),
    receiptFound: z.boolean(),
    receiptSuccess: z.boolean(),
    contentHashExpected: z.string().min(1),
    contentHashComputed: z.string().min(1),
    contentHashMatched: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const POST = createRouteHandler(async (request, context) => {
  const container = getContainer();
  const principal = await container.auth.authenticateApiKey(
    request.headers.get(API_KEY_HEADER),
  );
  if (!credentialHasScope(principal.scopes, 'telemetry:request')) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing telemetry:request scope.',
      status: 403,
    });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid verification payload.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const [row] = await container.db
    .insert(agentVerificationResults)
    .values({
      principalId: principal.principalId,
      telemetryRecordId: parsed.data.telemetryRecordId,
      paymentTransactionHash: parsed.data.paymentTransactionHash.toLowerCase(),
      status: parsed.data.status,
      receiptFound: parsed.data.receiptFound,
      receiptSuccess: parsed.data.receiptSuccess,
      contentHashExpected: parsed.data.contentHashExpected,
      contentHashComputed: parsed.data.contentHashComputed,
      contentHashMatched: parsed.data.contentHashMatched,
      details: parsed.data.details,
      verifiedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        agentVerificationResults.principalId,
        agentVerificationResults.telemetryRecordId,
        agentVerificationResults.paymentTransactionHash,
      ],
      set: {
        status: parsed.data.status,
        receiptFound: parsed.data.receiptFound,
        receiptSuccess: parsed.data.receiptSuccess,
        contentHashComputed: parsed.data.contentHashComputed,
        contentHashMatched: parsed.data.contentHashMatched,
        details: parsed.data.details,
        verifiedAt: new Date(),
      },
    })
    .returning();

  return jsonOk(
    {
      id: row?.id,
      status: parsed.data.status,
    },
    context.requestId,
    { status: 201 },
  );
});
