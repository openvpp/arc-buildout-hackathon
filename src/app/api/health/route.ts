import { getHealth } from '@/server/application/health/get-health';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Liveness probe — process is running. Independent of PostgreSQL / RPC so
 * orchestrators do not restart-loop on temporary dependency outages.
 */
export const GET = createRouteHandler(async (_request, context) => {
  return jsonOk(getHealth(), context.requestId);
});
