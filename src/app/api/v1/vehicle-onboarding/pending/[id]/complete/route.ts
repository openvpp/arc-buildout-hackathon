import { z } from 'zod';

import { finalizePendingVehicleConnection } from '@/server/application/onboarding/finalize-pending';
import { getDb } from '@/server/infrastructure/db/client';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { readJsonBody } from '@/server/transport/http/read-body';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    nickname: z.string().trim().min(1).max(80).optional(),
    consentAccepted: z.boolean(),
  })
  .strict();

/** POST /api/v1/vehicle-onboarding/pending/:id/complete — finish the wizard. */
export const POST = createRouteHandler<{ id: string }>(
  async (request, context) => {
    enforceRateLimit({
      request,
      bucket: 'vehicle-finalize',
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    const principal = await requirePrincipal();
    const { id } = paramsSchema.parse(context.params);
    const body = bodySchema.parse(await readJsonBody(request));

    const db = getDb();
    const result = await finalizePendingVehicleConnection(db, {
      pendingConnectionId: id,
      walletId: principal.walletId,
      ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
      consentAccepted: body.consentAccepted,
    });
    return jsonOk(
      {
        success: true as const,
        wasExistingDevice: result.wasExistingDevice,
        device: {
          id: result.device.id,
          displayName: result.device.displayName,
        },
        mintStatus: result.mintStatus,
      },
      context.requestId,
    );
  },
);
