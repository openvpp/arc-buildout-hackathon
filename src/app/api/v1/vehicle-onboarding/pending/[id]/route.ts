import { z } from 'zod';

import { getPendingConnection } from '@/server/application/onboarding/pending-oauth';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { requirePrincipal } from '@/server/transport/http/require-principal';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ id: z.string().uuid() });

/** GET /api/v1/vehicle-onboarding/pending/:id — poll the wizard status. */
export const GET = createRouteHandler<{ id: string }>(
  async (_request, context) => {
    await requirePrincipal();
    const { id } = paramsSchema.parse(context.params);

    const db = getDb();
    const pending = await getPendingConnection(db, id);
    if (pending === null) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Pending connection not found.',
        status: 404,
      });
    }
    return jsonOk(pending, context.requestId);
  },
);
