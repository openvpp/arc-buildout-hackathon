import { getDeviceTelemetrySnapshot } from '@/server/application/devices/get-device-telemetry';
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

  const result = await getDeviceTelemetrySnapshot({
    db: container.db,
    principal,
    deviceId,
  });

  return jsonOk(result, context.requestId);
});
