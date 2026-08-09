import { getAgentVerification } from '@/server/application/verification/get-agent-verification';
import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
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

  const result = await getAgentVerification({
    db: container.db,
    principal,
    telemetryRecordId,
  });

  return jsonOk(result, context.requestId);
});
