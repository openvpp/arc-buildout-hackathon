import { z } from 'zod';

import { bindDashboardOwnerWallet } from '@/server/application/onboarding/bind-dashboard-owner';
import { createVehicleLink } from '@/server/application/onboarding/create-vehicle-link';
import { getContainer } from '@/server/bootstrap/container';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, 'must be an EVM address'),
    brand: z.string().min(1).optional(),
    vendor: z.string().min(1).optional(),
    frontendUrl: z.string().url().optional(),
    redirectUri: z.string().url().optional(),
  })
  .strict();

/**
 * POST /api/v1/vehicle-onboarding/link
 * Requires Authorization: Bearer <Web3Auth idToken>.
 */
export const POST = createRouteHandler(async (request, context) => {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid link request.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const identity = await verifyWeb3AuthIdentity({
    authorizationHeader: request.headers.get('authorization'),
    claimedWalletAddress: parsed.data.walletAddress,
  });

  const container = getContainer();
  await bindDashboardOwnerWallet(container.db, identity);

  const result = await createVehicleLink(container.db, {
    walletAddress: identity.walletAddress,
    ...(parsed.data.brand !== undefined ? { brand: parsed.data.brand } : {}),
    ...(parsed.data.vendor !== undefined ? { vendor: parsed.data.vendor } : {}),
    ...(parsed.data.frontendUrl !== undefined
      ? { frontendUrl: parsed.data.frontendUrl }
      : {}),
    ...(parsed.data.redirectUri !== undefined
      ? { redirectUri: parsed.data.redirectUri }
      : {}),
  });

  if (!result.supported) {
    const status =
      result.reason === 'PROVIDER_UNAVAILABLE' ||
      result.reason === 'WALLET_ADDRESS_REQUIRED'
        ? 400
        : 502;
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: result.message ?? result.reason,
      status,
      details: { reason: result.reason },
    });
  }

  return jsonOk(result, context.requestId);
});
