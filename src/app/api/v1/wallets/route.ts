import { eq } from 'drizzle-orm';

import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { principalWallets, wallets } from '@/server/infrastructure/db/schema';
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

  const rows = await container.db
    .select({
      id: wallets.id,
      address: wallets.address,
      label: wallets.label,
      chainId: wallets.chainId,
      status: wallets.status,
    })
    .from(principalWallets)
    .innerJoin(wallets, eq(wallets.id, principalWallets.walletId))
    .where(eq(principalWallets.principalId, principal.principalId));

  return jsonOk(
    {
      items: rows.map((row) => ({
        id: row.id,
        address: row.address,
        label: row.label,
        chainId: String(row.chainId),
        status: row.status,
      })),
      pageInfo: { nextCursor: null, hasNextPage: false },
    },
    context.requestId,
  );
});
