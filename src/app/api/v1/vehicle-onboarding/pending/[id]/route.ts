import { getPendingConnection } from '@/server/application/onboarding/pending-oauth';
import { getContainer } from '@/server/bootstrap/container';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/vehicle-onboarding/pending/:id */
export const GET = createRouteHandler(async (request, requestContext) => {
  const id = new URL(request.url).pathname.split('/').at(-1);
  if (id === undefined || id.length === 0) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'pending id required',
      status: 400,
    });
  }

  const container = getContainer();
  const pending = await getPendingConnection(container.db, id);
  if (pending === null) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Pending connection not found.',
      status: 404,
    });
  }
  return jsonOk(pending, requestContext.requestId);
});
