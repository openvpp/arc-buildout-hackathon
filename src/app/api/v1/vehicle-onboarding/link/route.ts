import { z } from 'zod';

import { createVehicleLink } from '@/server/application/onboarding/create-vehicle-link';
import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { readJsonBody } from '@/server/transport/http/read-body';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

const log = createServerLogger({ component: 'vehicle-link-route' });

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({ brand: z.string().trim().min(1).max(64).optional() })
  .strict();

/** POST /api/v1/vehicle-onboarding/link — start an Enode Link session for the signed-in wallet. */
export const POST = createRouteHandler(async (request, context) => {
  enforceRateLimit({
    request,
    bucket: 'vehicle-link',
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  const principal = await requirePrincipal();
  const parsed = bodySchema.parse(await readJsonBody(request));

  const db = getDb();
  const result = await createVehicleLink(db, {
    walletId: principal.walletId,
    walletAddress: principal.walletAddress,
    normalizedWalletAddress: principal.walletAddress,
    ...(parsed.brand !== undefined ? { brand: parsed.brand } : {}),
  });

  if (!result.supported) {
    log.warn('vehicle_link.unavailable', {
      requestId: context.requestId,
      reason: result.reason,
    });
    const status = result.reason === 'PROVIDER_UNAVAILABLE' ? 400 : 502;
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message:
        result.reason === 'PROVIDER_UNAVAILABLE'
          ? 'Vehicle linking is not configured.'
          : 'Could not start the vehicle link. Try again.',
      status,
      details: { reason: result.reason },
    });
  }
  return jsonOk(result, context.requestId);
});
