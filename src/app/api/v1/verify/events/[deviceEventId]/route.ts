import { z } from 'zod';

import { getPublicEventVerification } from '@/server/application/verification/public-verification';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';
import {
  enforcePublicVerificationLimits,
  wantsRefresh,
} from '@/server/transport/http/verification-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ deviceEventId: z.string().uuid() });

/**
 * GET /api/v1/verify/events/:deviceEventId[?refresh=1] — public. A record's
 * on-chain anchor, published payload and latest independent verification.
 * Unauthenticated by design: anyone (or any agent) can check a record.
 */
export const GET = createRouteHandler<{ deviceEventId: string }>(
  async (request, context) => {
    const refresh = wantsRefresh(request);
    enforcePublicVerificationLimits(request, refresh);
    const { deviceEventId } = paramsSchema.parse(context.params);
    const result = await getPublicEventVerification(getDb(), {
      deviceEventId,
      refresh,
    });
    if (result === null) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Record not found.',
        status: 404,
      });
    }
    return jsonOk(result, context.requestId);
  },
);
