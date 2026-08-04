import { z } from 'zod';

import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { createMockCircleGatewayBuyer } from '@/server/infrastructure/payments/circle-gateway-buyer';
import {
  findGatewayBatchingOption,
  parsePaymentRequiredHeader,
} from '@/server/infrastructure/payments/circle-gateway-seller';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    deviceId: z.string().uuid(),
    action: z.enum(['quote', 'settle']),
  })
  .strict();

/**
 * Demo-only BFF for dashboard mock buy flow.
 * Keeps AGENT_API_KEY on the server. Forbidden unless ALLOW_MOCK_ADAPTERS=true.
 */
export const POST = createRouteHandler(async (request, context) => {
  const env = getServerEnv();
  if (!env.ALLOW_MOCK_ADAPTERS) {
    throw new ApiError({
      code: 'SERVICE_UNAVAILABLE',
      message:
        'Demo telemetry purchase is only available when ALLOW_MOCK_ADAPTERS=true.',
      status: 503,
    });
  }

  const apiKey = env.AGENT_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    throw new ApiError({
      code: 'SERVICE_UNAVAILABLE',
      message:
        'AGENT_API_KEY is required in server env for the demo purchase UI.',
      status: 503,
    });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid demo telemetry request.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const container = getContainer();
  const principal = await container.auth.authenticateApiKey(apiKey);
  if (!credentialHasScope(principal.scopes, 'telemetry:request')) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Demo agent key missing telemetry:request scope.',
      status: 403,
    });
  }

  const resourceUrl = `${new URL(request.url).origin}/api/v1/agent/telemetry/latest`;

  if (parsed.data.action === 'quote') {
    const result = await requestLatestTelemetry({
      db: container.db,
      principal,
      pricing: container.pricing,
      circleSeller: container.circleSeller,
      walletAddress: parsed.data.walletAddress,
      deviceId: parsed.data.deviceId,
      paymentSignatureHeader: null,
      resourceUrl,
    });
    return respond(result, env.PAYMENT_PROTOCOL_VERSION, context.requestId);
  }

  const quoted = await requestLatestTelemetry({
    db: container.db,
    principal,
    pricing: container.pricing,
    circleSeller: container.circleSeller,
    walletAddress: parsed.data.walletAddress,
    deviceId: parsed.data.deviceId,
    paymentSignatureHeader: null,
    resourceUrl,
  });

  if (quoted.kind !== 'PAYMENT_REQUIRED') {
    return respond(quoted, env.PAYMENT_PROTOCOL_VERSION, context.requestId);
  }

  const paymentRequired = parsePaymentRequiredHeader(
    quoted.paymentRequiredHeader,
  );
  const batching = findGatewayBatchingOption(paymentRequired);
  if (batching === null) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Demo payment requirements missing Gateway batching option.',
      status: 500,
      expose: false,
    });
  }

  const buyer = createMockCircleGatewayBuyer();
  const signature = await buyer.createPaymentSignature({
    x402Version: paymentRequired.x402Version,
    requirements: batching,
    resource: paymentRequired.resource,
  });

  const settled = await requestLatestTelemetry({
    db: container.db,
    principal,
    pricing: container.pricing,
    circleSeller: container.circleSeller,
    walletAddress: parsed.data.walletAddress,
    deviceId: parsed.data.deviceId,
    paymentSignatureHeader: signature,
    resourceUrl,
  });

  return respond(settled, env.PAYMENT_PROTOCOL_VERSION, context.requestId);
});

function respond(
  result: Awaited<ReturnType<typeof requestLatestTelemetry>>,
  paymentProtocolVersion: string,
  requestId: string,
) {
  switch (result.kind) {
    case 'NO_TELEMETRY_AVAILABLE':
      return jsonOk(
        {
          status: 'NO_TELEMETRY_AVAILABLE',
          deviceId: result.deviceId,
          checkedAt: result.checkedAt,
        },
        requestId,
      );
    case 'NO_NEW_RECORD':
      return jsonOk(
        {
          status: 'NO_NEW_RECORD',
          deviceId: result.deviceId,
          latestDeliveredTelemetryRecordId:
            result.latestDeliveredTelemetryRecordId,
          checkedAt: result.checkedAt,
        },
        requestId,
      );
    case 'PAYMENT_REQUIRED':
      return jsonOk(
        {
          status: 'PAYMENT_REQUIRED',
          paymentProtocolVersion,
          paymentRequirement: result.paymentRequirement,
          telemetryReference: result.telemetryReference,
          demoNote:
            'Mock settle only. Click Pay (mock) — not live Circle evidence.',
        },
        requestId,
      );
    case 'TELEMETRY_DELIVERED':
      return jsonOk(
        {
          status: 'TELEMETRY_DELIVERED',
          deliveryId: result.deliveryId,
          telemetry: result.telemetry,
          payment: result.payment,
          provenance: result.provenance,
          demoNote: 'Mock settlement — not live payment evidence.',
        },
        requestId,
      );
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
