import { NextResponse } from 'next/server';
import { z } from 'zod';

import { agentUnlockedResponse } from '@/server/application/unlocks/agent-catalog';
import { requestEventUnlock } from '@/server/application/unlocks/event-unlock';
import { getDb } from '@/server/infrastructure/db/client';
import {
  createConfiguredSeller,
  resolvePaymentConfig,
} from '@/server/infrastructure/payments/payment-config';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '@/server/infrastructure/payments/x402';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const paramsSchema = z.object({ eventId: z.string().uuid() });

/**
 * GET /api/v1/agent/events/:eventId — paid with x402 (Circle Gateway
 * nanopayment on Arc). Without PAYMENT-SIGNATURE: 402 + PAYMENT-REQUIRED.
 * With it: settle, then the record (no location) with its proof and
 * receipt. Paying twice for the same event returns it without a charge.
 */
export const GET = createRouteHandler<{ eventId: string }>(
  async (request, context) => {
    enforceRateLimit({
      request,
      bucket: 'agent-unlock',
      limit: 30,
      windowMs: 60 * 1000,
    });
    const { eventId } = paramsSchema.parse(context.params);
    const resolved = resolvePaymentConfig();
    if (!resolved.ok) {
      throw new ApiError({
        code: 'UNLOCKS_UNAVAILABLE',
        message: 'Paid data is not available on this deployment.',
        status: 503,
      });
    }
    const { config } = resolved;
    const db = getDb();
    const result = await requestEventUnlock({
      db,
      eventId,
      buyer: { kind: 'agent' },
      paymentSignatureHeader: request.headers.get(PAYMENT_SIGNATURE_HEADER),
      resourceUrl: request.url,
      config,
      seller: createConfiguredSeller(config.network),
    });
    if (result.kind === 'payment_required') {
      const response = NextResponse.json(
        {
          ok: false,
          error: {
            code: 'PAYMENT_REQUIRED',
            message: `Unlocking this event costs ${result.priceAtomic.toString()} atomic USDC (6 decimals) on ${config.network.caip2}. Pay with x402: retry with a PAYMENT-SIGNATURE header.`,
          },
          paymentRequired: result.paymentRequired,
          requestId: context.requestId,
        },
        { status: 402 },
      );
      response.headers.set(
        PAYMENT_REQUIRED_HEADER,
        result.paymentRequiredHeader,
      );
      response.headers.set('x-request-id', context.requestId);
      return response;
    }
    return jsonOk(await agentUnlockedResponse(db, result), context.requestId);
  },
);
