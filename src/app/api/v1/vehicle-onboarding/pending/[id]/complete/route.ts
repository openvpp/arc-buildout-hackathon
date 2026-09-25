import { z } from 'zod';

import { finalizePendingVehicleConnection } from '@/server/application/onboarding/finalize-pending';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    nickname: z.string().min(1).optional(),
    consentAccepted: z.boolean(),
  })
  .strict();

const ERROR_STATUS: Record<string, number> = {
  PENDING_CONNECTION_NOT_FOUND: 404,
  USER_ID_MISMATCH: 403,
  PENDING_EXPIRED: 409,
  PENDING_INVALID_STATUS: 409,
  PENDING_CONNECTION_COMPLETED: 409,
  PENDING_OAUTH_INCOMPLETE: 409,
  CONSENT_REQUIRED: 400,
  DEVICE_PERSIST_FAILED: 500,
};

/** POST /api/v1/vehicle-onboarding/pending/:id/complete — finish the wizard. */
export const POST = createRouteHandler<{ id: string }>(
  async (request, context) => {
    const principal = await requirePrincipal();
    const { id } = paramsSchema.parse(context.params);
    const body = bodySchema.parse(await request.json());

    const db = getDb();
    try {
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
    } catch (error) {
      const code =
        error instanceof Error && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'INTERNAL_ERROR';
      throw new ApiError({
        code,
        message: error instanceof Error ? error.message : 'Finalize failed.',
        status: ERROR_STATUS[code] ?? 500,
      });
    }
  },
);
