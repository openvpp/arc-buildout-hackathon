import { buildVerificationSpec } from '@/server/application/verification/verification-spec';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/verify/spec — public, machine-readable verification rules. */
export const GET = createRouteHandler(async (_request, context) =>
  jsonOk(buildVerificationSpec(), context.requestId),
);
