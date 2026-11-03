import { z } from 'zod';

import { listAgentCatalog } from '@/server/application/unlocks/agent-catalog';
import { getDb } from '@/server/infrastructure/db/client';
import { resolvePaymentConfig } from '@/server/infrastructure/payments/payment-config';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
  tokenId: z.string().regex(/^\d+$/).optional(),
});

/**
 * GET /api/v1/agent/events — public, free, rate-limited. Anchored device
 * events with only already-public on-chain data, their verdict and price.
 * Unlock one with GET /api/v1/agent/events/:id (x402).
 */
export const GET = createRouteHandler(async (request, context) => {
  enforceRateLimit({
    request,
    bucket: 'agent-catalog',
    limit: 60,
    windowMs: 60 * 1000,
  });
  const resolved = resolvePaymentConfig();
  if (!resolved.ok) {
    throw new ApiError({
      code: 'UNLOCKS_UNAVAILABLE',
      message: 'Paid data is not available on this deployment.',
      status: 503,
    });
  }
  const url = new URL(request.url);
  const query = querySchema.parse(Object.fromEntries(url.searchParams));
  const page = await listAgentCatalog(getDb(), {
    config: resolved.config,
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
    ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
    ...(query.tokenId !== undefined ? { tokenId: query.tokenId } : {}),
  });
  return jsonOk(
    {
      ...page,
      payment: {
        protocol: 'x402',
        x402Version: 2,
        network: resolved.config.network.caip2,
        asset: resolved.config.network.usdcAddress,
        priceAtomic: resolved.config.unlockPriceAtomic.toString(),
        decimals: 6,
      },
    },
    context.requestId,
  );
});
