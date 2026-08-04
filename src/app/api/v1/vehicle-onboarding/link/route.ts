import { z } from 'zod';

import { createVehicleLink } from '@/server/application/onboarding/create-vehicle-link';
import { getContainer } from '@/server/bootstrap/container';
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
 * Temporary wallet-address auth stub until Web3Auth.
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

  const container = getContainer();
  const result = await createVehicleLink(container.db, {
    walletAddress: parsed.data.walletAddress,
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
