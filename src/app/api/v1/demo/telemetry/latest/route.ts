import { z } from 'zod';

import { bindDashboardOwnerWallet } from '@/server/application/onboarding/bind-dashboard-owner';
import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import { formatAtomicAmount } from '@/server/domain/shared/money';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import {
  createCircleGatewayBuyer,
  createMockCircleGatewayBuyer,
} from '@/server/infrastructure/payments/circle-gateway-buyer';
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
 * Dashboard BFF for “Request latest” quote/settle.
 * Auth: Web3Auth Bearer (device owner). Settle: live Circle buyer unless mocks on.
 */
export const POST = createRouteHandler(async (request, context) => {
  const env = getServerEnv();
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid telemetry purchase request.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  if (!env.ALLOW_MOCK_ADAPTERS) {
    if (
      env.ARC_PAYMENT_SIGNER_PRIVATE_KEY === undefined ||
      env.ARC_PAYMENT_SIGNER_PRIVATE_KEY.length === 0
    ) {
      throw new ApiError({
        code: 'SERVICE_UNAVAILABLE',
        message:
          'ARC_PAYMENT_SIGNER_PRIVATE_KEY is required for live dashboard settle.',
        status: 503,
      });
    }
  }

  const identity = await verifyWeb3AuthIdentity({
    authorizationHeader: request.headers.get('authorization'),
    claimedWalletAddress: parsed.data.walletAddress,
  });

  const container = getContainer();
  const bound = await bindDashboardOwnerWallet(container.db, identity);
  const principal: AuthenticatedPrincipal = {
    principalId: bound.principalId,
    principalType: 'dashboard_user',
    credentialId: 'web3auth-session',
    scopes: ['telemetry:request', 'telemetry:read', 'devices:read'],
    keyPrefix: 'web3auth',
  };

  const resourceUrl = `${new URL(request.url).origin}/api/v1/agent/telemetry/latest`;
  const liveMode = !env.ALLOW_MOCK_ADAPTERS;

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
    return respond(result, env.PAYMENT_PROTOCOL_VERSION, context.requestId, {
      liveMode,
    });
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
    return respond(quoted, env.PAYMENT_PROTOCOL_VERSION, context.requestId, {
      liveMode,
    });
  }

  const paymentRequired = parsePaymentRequiredHeader(
    quoted.paymentRequiredHeader,
  );
  const batching = findGatewayBatchingOption(paymentRequired);
  if (batching === null) {
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: 'Payment requirements missing Gateway batching option.',
      status: 500,
      expose: false,
    });
  }

  const buyer = liveMode
    ? createCircleGatewayBuyer()
    : createMockCircleGatewayBuyer();
  const amountUsdc = Number(formatAtomicAmount(batching.amount, 6));
  await buyer.ensureLiquidity(amountUsdc);
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

  return respond(settled, env.PAYMENT_PROTOCOL_VERSION, context.requestId, {
    liveMode,
  });
});

function respond(
  result: Awaited<ReturnType<typeof requestLatestTelemetry>>,
  paymentProtocolVersion: string,
  requestId: string,
  options: { liveMode: boolean },
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
          demoNote: options.liveMode
            ? 'Live Circle Gateway settle via server payment signer.'
            : 'Mock settle only — not live Circle evidence.',
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
          demoNote: options.liveMode
            ? undefined
            : 'Mock settlement — not live payment evidence.',
        },
        requestId,
      );
    default: {
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}
