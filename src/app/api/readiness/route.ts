import { getReadiness } from '@/server/application/health/get-readiness';
import { getContainer } from '@/server/bootstrap/container';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk, jsonError } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Readiness probe — critical dependencies (config + PostgreSQL) must be up.
 * Returns HTTP 503 when not ready. Does not expose connection strings.
 */
export const GET = createRouteHandler(async (_request, context) => {
  try {
    const container = getContainer();
    const result = await getReadiness(container);

    if (result.status === 'not_ready') {
      return jsonError(
        new ApiError({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Service is not ready.',
          status: 503,
          details: {
            checks: result.checks.map((check) => ({
              name: check.name,
              status: check.status,
            })),
          },
        }),
        context.requestId,
      );
    }

    return jsonOk(result, context.requestId);
  } catch {
    return jsonError(
      new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service is not ready.',
        status: 503,
      }),
      context.requestId,
    );
  }
});
