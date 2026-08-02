import { and, eq } from 'drizzle-orm';

import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import {
  devices,
  principalWallets,
  wallets,
} from '@/server/infrastructure/db/schema';
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

  const [access] = await container.db
    .select()
    .from(principalWallets)
    .where(
      and(
        eq(principalWallets.principalId, principal.principalId),
        eq(principalWallets.walletId, walletId),
      ),
    )
    .limit(1);

  if (access === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet not found.',
      status: 404,
    });
  }

  const [wallet] = await container.db
    .select()
    .from(wallets)
    .where(eq(wallets.id, walletId))
    .limit(1);

  if (wallet === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet not found.',
      status: 404,
    });
  }

  const deviceRows = await container.db
    .select()
    .from(devices)
    .where(eq(devices.walletId, walletId));

  return jsonOk(
    {
      id: wallet.id,
      address: wallet.address,
      label: wallet.label,
      chainId: String(wallet.chainId),
      status: wallet.status,
      devices: deviceRows.map((device) => ({
        id: device.id,
        displayName: device.displayName,
        vendor: device.vendor,
        model: device.model,
        status: device.status,
        externalDeviceId: device.externalDeviceId,
      })),
    },
    requestContext.requestId,
  );
});
