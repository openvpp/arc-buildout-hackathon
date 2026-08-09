import { z } from 'zod';

import {
  AGENT_VERIFICATION_STATUSES,
  recordAgentVerification,
} from '@/server/application/verification/record-agent-verification';
import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    telemetryRecordId: z.string().uuid(),
    paymentTransactionHash: z.string().min(1),
    status: z.enum(AGENT_VERIFICATION_STATUSES),
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

  const result = await recordAgentVerification({
    db: container.db,
    principal,
    payload: {
      telemetryRecordId: parsed.data.telemetryRecordId,
      paymentTransactionHash: parsed.data.paymentTransactionHash,
      status: parsed.data.status,
      receiptFound: parsed.data.receiptFound,
      receiptSuccess: parsed.data.receiptSuccess,
      contentHashExpected: parsed.data.contentHashExpected,
      contentHashComputed: parsed.data.contentHashComputed,
      contentHashMatched: parsed.data.contentHashMatched,
      ...(parsed.data.details === undefined
        ? {}
        : { details: parsed.data.details }),
    },
  });

  return jsonOk(
    {
      id: result.id,
      status: result.status,
      source: result.source,
    },
    context.requestId,
    { status: 201 },
  );
});
