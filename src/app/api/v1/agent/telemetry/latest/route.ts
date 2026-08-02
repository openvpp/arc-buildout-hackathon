import { z } from 'zod';

import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { getContainer } from '@/server/bootstrap/container';
import {
  API_KEY_HEADER,
  PAYMENT_PROTOCOL_HEADER,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '@/server/config/constants';
import { getServerEnv } from '@/server/config/env';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { ApiError } from '@/server/transport/http/api-error';
import {
  jsonOk,
  jsonPaymentRequired,
} from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    deviceId: z.string().uuid(),
    lastKnownTelemetryRecordId: z.string().uuid().optional(),
  })
  .strict();

export const POST = createRouteHandler(async (request, context) => {
  const container = getContainer();
  const apiKey = request.headers.get(API_KEY_HEADER);
  const principal = await container.auth.authenticateApiKey(apiKey);

  if (!credentialHasScope(principal.scopes, 'telemetry:request')) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing telemetry:request scope.',
      status: 403,
    });
  }

  const json: unknown = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request body.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const paymentSignature = request.headers.get(PAYMENT_SIGNATURE_HEADER);
  const result = await requestLatestTelemetry({
    db: container.db,
    principal,
    pricing: container.pricing,
    circleSeller: container.circleSeller,
    walletAddress: parsed.data.walletAddress,
    deviceId: parsed.data.deviceId,
    paymentSignatureHeader: paymentSignature,
    resourceUrl: request.url,
  });

  const env = getServerEnv();

  switch (result.kind) {
    case 'NO_TELEMETRY_AVAILABLE':
      return jsonOk(
        {
          status: 'NO_TELEMETRY_AVAILABLE',
          deviceId: result.deviceId,
          checkedAt: result.checkedAt,
        },
        context.requestId,
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
        context.requestId,
      );
    case 'PAYMENT_REQUIRED': {
      const response = jsonPaymentRequired(
        {
          status: 'PAYMENT_REQUIRED',
          paymentProtocolVersion: env.PAYMENT_PROTOCOL_VERSION,
          paymentRequirement: result.paymentRequirement,
          telemetryReference: result.telemetryReference,
        },
        context.requestId,
        env.PAYMENT_PROTOCOL_VERSION,
      );
      response.headers.set(
        PAYMENT_REQUIRED_HEADER,
        result.paymentRequiredHeader,
      );
      response.headers.set(
        PAYMENT_PROTOCOL_HEADER,
        env.PAYMENT_PROTOCOL_VERSION,
      );
      return response;
    }
    case 'TELEMETRY_DELIVERED':
      return jsonOk(
        {
          status: 'TELEMETRY_DELIVERED',
          deliveryId: result.deliveryId,
          telemetry: result.telemetry,
          payment: result.payment,
          provenance: result.provenance,
        },
        context.requestId,
      );
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
});
