import { z } from 'zod';

import { listDeviceEventsForWallet } from '@/server/application/dashboard/list-device-events';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ deviceId: z.string().uuid() });
const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

/**
 * GET /api/v1/dashboard/devices/:deviceId/events — the device's on-chain
 * time series (charging sessions and daily odometer), newest first. Owner
 * only; another wallet's device is a 404.
 */
export const GET = createRouteHandler<{ deviceId: string }>(
  async (request, context) => {
    const principal = await requirePrincipal();
    const { deviceId } = paramsSchema.parse(context.params);
    const url = new URL(request.url);
    const query = querySchema.parse({
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });

    const page = await listDeviceEventsForWallet(getDb(), {
      deviceId,
      walletId: principal.walletId,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    });
    if (page === null) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Device not found.',
        status: 404,
      });
    }
    return jsonOk(page, context.requestId);
  },
);
