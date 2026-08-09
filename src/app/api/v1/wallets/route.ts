import { listWalletsForPrincipal } from '@/server/application/wallets/list-wallets';
import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createRouteHandler(async (request, context) => {
  const container = getContainer();
  const principal = await container.auth.authenticateApiKey(
    request.headers.get(API_KEY_HEADER),
  );
  if (
    !credentialHasScope(principal.scopes, 'wallets:read') &&
    !credentialHasScope(principal.scopes, 'telemetry:read')
  ) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing read scope.',
      status: 403,
    });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  const limit =
    limitParam === null || limitParam.length === 0
      ? undefined
      : Number.parseInt(limitParam, 10);

  if (limit !== undefined && !Number.isFinite(limit)) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'limit must be a number.',
      status: 400,
    });
  }

  const result = await listWalletsForPrincipal({
    db: container.db,
    principal,
    ...(cursor === null ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  });

  return jsonOk(result, context.requestId);
});
