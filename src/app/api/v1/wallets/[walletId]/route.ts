import { getWalletForPrincipal } from '@/server/application/wallets/get-wallet';
import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createRouteHandler(async (request, requestContext) => {
  const container = getContainer();
  const principal = await container.auth.authenticateApiKey(
    request.headers.get(API_KEY_HEADER),
  );
  if (!credentialHasScope(principal.scopes, 'wallets:read')) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing wallets:read scope.',
      status: 403,
    });
  }

  const walletId = new URL(request.url).pathname.split('/').at(-1);
  if (walletId === undefined || walletId.length === 0) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'walletId required',
      status: 400,
    });
  }

  const result = await getWalletForPrincipal({
    db: container.db,
    principal,
    walletId,
  });

  return jsonOk(result, requestContext.requestId);
});
