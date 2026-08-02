import { and, desc, eq } from 'drizzle-orm';

import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import {
  agentVerificationResults,
  devices,
  principalWallets,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = createRouteHandler(async (request, context) => {
  const container = getContainer();
  const principal = await container.auth.authenticateApiKey(
    request.headers.get(API_KEY_HEADER),
  );
  if (!credentialHasScope(principal.scopes, 'telemetry:read')) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing telemetry:read scope.',
      status: 403,
    });
  }

  const deviceId = new URL(request.url).pathname.split('/').at(-2);
  if (deviceId === undefined) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'deviceId required',
      status: 400,
    });
  }

  const [device] = await container.db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (device === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Device not found.',
      status: 404,
    });
  }

  const [access] = await container.db
    .select()
    .from(principalWallets)
    .where(
      and(
        eq(principalWallets.principalId, principal.principalId),
        eq(principalWallets.walletId, device.walletId),
      ),
    )
    .limit(1);
  if (access === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Device not found.',
      status: 404,
    });
  }

  const [latest] = await container.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.deviceId, deviceId))
    .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
    .limit(1);

  let verification = null;
  if (latest !== undefined) {
    const [result] = await container.db
      .select()
      .from(agentVerificationResults)
      .where(eq(agentVerificationResults.telemetryRecordId, latest.id))
      .orderBy(desc(agentVerificationResults.verifiedAt))
      .limit(1);
    if (result !== undefined) {
      verification = {
        status: result.status,
        paymentTransactionHash: result.paymentTransactionHash,
        contentHashMatched: result.contentHashMatched,
        receiptSuccess: result.receiptSuccess,
        verifiedAt: result.verifiedAt.toISOString(),
      };
    }
  }

  return jsonOk(
    {
      device: {
        id: device.id,
        walletId: device.walletId,
        displayName: device.displayName,
        vendor: device.vendor,
        model: device.model,
        status: device.status,
      },
      latestTelemetry:
        latest === undefined
          ? null
          : {
              recordId: latest.id,
              recordedAt: latest.recordedAt.toISOString(),
              contentHash: latest.contentHash,
              anchorStatus: latest.anchorStatus,
              anchorTransactionHash: latest.anchorTransactionHash,
              data: latest.telemetryPayload,
            },
      verification,
    },
    context.requestId,
  );
});
