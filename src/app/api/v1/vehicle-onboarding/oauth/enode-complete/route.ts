import { z } from 'zod';

import { onEnodeOAuthComplete } from '@/server/application/onboarding/pending-oauth';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({ pendingId: z.string().uuid() });

/** GET /api/v1/vehicle-onboarding/oauth/enode-complete?pendingId=... — after the OEM redirect. */
export const GET = createRouteHandler(async (request, context) => {
  const principal = await requirePrincipal();
  const parsed = querySchema.parse({
    pendingId: new URL(request.url).searchParams.get('pendingId'),
  });

  const db = getDb();
  const result = await onEnodeOAuthComplete(db, {
    pendingId: parsed.pendingId,
    walletId: principal.walletId,
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
