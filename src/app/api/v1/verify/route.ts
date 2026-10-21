import {
  verifyClaim,
  verifyClaimInputSchema,
} from '@/server/application/verification/public-verification';
import { getDb } from '@/server/infrastructure/db/client';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { readJsonBody } from '@/server/transport/http/read-body';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/verify — public. "I hold this payload and this transaction:
 * is it genuinely anchored, by an authorized writer, unchanged?" Works for
 * any DeviceEvent on the configured contract. Nothing is stored.
 */
export const POST = createRouteHandler(async (request, context) => {
  enforceRateLimit({
    request,
    bucket: 'verify-claim',
    limit: 20,
    windowMs: 60 * 1000,
  });
  const input = verifyClaimInputSchema.parse(await readJsonBody(request));
  const result = await verifyClaim(getDb(), input);
  return jsonOk(result, context.requestId);
});
