import { z } from 'zod';

import { createVehicleLink } from '@/server/application/onboarding/create-vehicle-link';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({ brand: z.string().min(1).optional() }).strict();

/** POST /api/v1/vehicle-onboarding/link — start an Enode Link session for the signed-in wallet. */
export const POST = createRouteHandler(async (request, context) => {
  const principal = await requirePrincipal();
  const parsed = bodySchema.parse(await request.json().catch(() => ({})));

  const db = getDb();
  const result = await createVehicleLink(db, {
    walletId: principal.walletId,
    walletAddress: principal.walletAddress,
    normalizedWalletAddress: principal.walletAddress,
    ...(parsed.brand !== undefined ? { brand: parsed.brand } : {}),
  });

  if (!result.supported) {
    const status = result.reason === 'PROVIDER_UNAVAILABLE' ? 400 : 502;
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: result.message ?? result.reason,
      status,
      details: { reason: result.reason },
    });
  }
  return jsonOk(result, context.requestId);
});
