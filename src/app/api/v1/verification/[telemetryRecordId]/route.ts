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
  if (
    !credentialHasScope(principal.scopes, 'telemetry:read') &&
    !credentialHasScope(principal.scopes, 'telemetry:request')
  ) {
    throw new ApiError({
      code: 'ACCESS_DENIED',
      message: 'Missing telemetry read scope.',
      status: 403,
    });
  }

  const telemetryRecordId = new URL(request.url).pathname.split('/').at(-1);
  if (telemetryRecordId === undefined || telemetryRecordId.length === 0) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'telemetryRecordId required',
      status: 400,
    });
  }

  const [record] = await container.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.id, telemetryRecordId))
    .limit(1);
  if (record === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found.',
      status: 404,
    });
  }

  const [device] = await container.db
    .select()
    .from(devices)
    .where(eq(devices.id, record.deviceId))
    .limit(1);
  if (device === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Telemetry record not found.',
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
      message: 'Telemetry record not found.',
      status: 404,
    });
  }

  const [verification] = await container.db
    .select()
    .from(agentVerificationResults)
    .where(
      and(
        eq(agentVerificationResults.principalId, principal.principalId),
        eq(agentVerificationResults.telemetryRecordId, telemetryRecordId),
      ),
    )
    .orderBy(desc(agentVerificationResults.verifiedAt))
    .limit(1);

  return jsonOk(
    {
      telemetryRecordId,
      contentHash: record.contentHash,
      verification:
        verification === undefined
          ? null
          : {
              status: verification.status,
              paymentTransactionHash: verification.paymentTransactionHash,
              receiptFound: verification.receiptFound,
              receiptSuccess: verification.receiptSuccess,
              contentHashMatched: verification.contentHashMatched,
              contentHashExpected: verification.contentHashExpected,
              contentHashComputed: verification.contentHashComputed,
              verifiedAt: verification.verifiedAt.toISOString(),
            },
    },
    context.requestId,
  );
});
