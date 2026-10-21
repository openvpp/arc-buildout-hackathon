import { z } from 'zod';

import {
  getPublicEventVerification,
  transactionHashSchema,
} from '@/server/application/verification/public-verification';
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

const paramsSchema = z.object({ transactionHash: transactionHashSchema });

/** GET /api/v1/verify/tx/:transactionHash[?refresh=1] — public lookup by tx. */
export const GET = createRouteHandler<{ transactionHash: string }>(
  async (request, context) => {
    const refresh = wantsRefresh(request);
    enforcePublicVerificationLimits(request, refresh);
    const { transactionHash } = paramsSchema.parse(context.params);
    const result = await getPublicEventVerification(getDb(), {
      transactionHash,
      refresh,
    });
    if (result === null) {
      throw new ApiError({
        code: 'RESOURCE_NOT_FOUND',
        message:
          'No record from this app has that transaction. To check any DeviceEvent, POST it with its payload to /api/v1/verify.',
        status: 404,
      });
    }
    return jsonOk(result, context.requestId);
  },
);
