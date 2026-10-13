import { z } from 'zod';

import {
  deviceAddressInputSchema,
  setDeviceAddressForOwner,
} from '@/server/application/location/device-address';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { readJsonBody } from '@/server/transport/http/read-body';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ deviceId: z.string().uuid() });

/**
 * PUT /api/v1/dashboard/devices/:deviceId/address — owner sets or changes
 * the device's address. The server geocodes it; the browser never sends
 * coordinates. The response never includes coordinates either.
 */
export const PUT = createRouteHandler<{ deviceId: string }>(
  async (request, context) => {
    enforceRateLimit({
      request,
      bucket: 'device-address',
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    const principal = await requirePrincipal();
    const { deviceId } = paramsSchema.parse(context.params);
    const address = deviceAddressInputSchema.parse(await readJsonBody(request));

    const saved = await setDeviceAddressForOwner(getDb(), {
      deviceId,
      walletId: principal.walletId,
      principalId: principal.principalId,
      address,
    });
    if (saved === null) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Device not found.',
        status: 404,
      });
    }
    return jsonOk(saved, context.requestId);
  },
);
