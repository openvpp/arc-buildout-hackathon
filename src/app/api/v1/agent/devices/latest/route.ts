import { z } from 'zod';

import { getLatestAgentDevice } from '@/server/application/agent/get-latest-agent-device';
import { getContainer } from '@/server/bootstrap/container';
import { API_KEY_HEADER } from '@/server/config/constants';
import { credentialHasScope } from '@/server/infrastructure/auth/api-keys';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

/**
 * GET /api/v1/agent/devices/latest?walletAddress=0x…
 * Newest onboarded device for the authenticated principal's wallet.
 */
export const GET = createRouteHandler(async (request, context) => {
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

  const parsed = querySchema.safeParse({
    walletAddress: new URL(request.url).searchParams.get('walletAddress'),
  });
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'walletAddress query parameter is required.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const device = await getLatestAgentDevice({
    db: container.db,
    principal,
    walletAddress: parsed.data.walletAddress,
  });

  return jsonOk({ device }, context.requestId);
});
