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
export const GET = createRouteHandler(async (_request, context) => {
  const db = getDb();
  const locations = await listAllDeviceLocations(db);
  return jsonOk({ locations }, context.requestId);
});
