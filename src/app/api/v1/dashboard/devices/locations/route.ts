import { listDeviceLocationsForWallet } from '@/server/application/dashboard/list-device-locations';
import { getDb } from '@/server/infrastructure/db/client';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/dashboard/devices/locations — pins for the signed-in wallet's globe. */
export const GET = createRouteHandler(async (_request, context) => {
  const principal = await requirePrincipal();
  const db = getDb();
  const locations = await listDeviceLocationsForWallet(db, {
    walletId: principal.walletId,
  });
  return jsonOk({ locations }, context.requestId);
});
