import { z } from 'zod';

import { onEnodeOAuthComplete } from '@/server/application/onboarding/pending-oauth';
import { getContainer } from '@/server/bootstrap/container';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  ovppPending: z.string().uuid(),
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'must be an EVM address'),
});

/** GET /api/v1/vehicle-onboarding/oauth/enode-complete */
export const GET = createRouteHandler(async (request, context) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    ovppPending: url.searchParams.get('ovppPending'),
    walletAddress: url.searchParams.get('walletAddress'),
  });
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'ovppPending and walletAddress are required.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const container = getContainer();
  const result = await onEnodeOAuthComplete(container.db, {
    pendingId: parsed.data.ovppPending,
    walletAddress: parsed.data.walletAddress,
  });

  if (!result.ok) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: result.message,
      status: 400,
    });
  }

  return jsonOk(result, context.requestId);
});
