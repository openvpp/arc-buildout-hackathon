import { z } from 'zod';

import { listAllDeviceLocations } from '@/server/application/dashboard/list-device-locations';
import { getDb } from '@/server/infrastructure/db/client';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/dashboard/devices/locations — public pins for the globe.
 * Deliberately unauthenticated: the globe shows the whole connected fleet
 * to any visitor, not just the signed-in wallet's own devices.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export const GET = createRouteHandler(async (request, context) => {
  const url = new URL(request.url);
  const parsed = querySchema.parse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  const db = getDb();
  const page = await listAllDeviceLocations(db, {
    ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    ...(parsed.cursor !== undefined ? { cursor: parsed.cursor } : {}),
  });
  return jsonOk(page, context.requestId);
});
