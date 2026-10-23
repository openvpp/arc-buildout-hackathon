import { getVerificationSpec } from '@/server/application/verification/verification-spec';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';
import { enforcePublicVerificationLimits } from '@/server/transport/http/verification-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/verify/spec — public, machine-readable verification rules.
 * Rate-limited like every public verify route; built once per process.
 */
export const GET = createRouteHandler(async (request, context) => {
  enforcePublicVerificationLimits(request, false);
  return jsonOk(getVerificationSpec(), context.requestId);
});
