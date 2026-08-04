import { createHash } from 'node:crypto';

import { receiveEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import {
  extractClientIp,
  isIpAllowed,
  parseIpAllowlist,
} from '@/server/infrastructure/http/ip-allowlist';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createRouteHandler(async (request, context) => {
  const env = getServerEnv();
  const allowlist = parseIpAllowlist(env.ENODE_WEBHOOK_ALLOWED_IPS);
  if (allowlist.length > 0) {
    const clientIp = extractClientIp(request);
    if (!isIpAllowed(clientIp, allowlist)) {
      throw new ApiError({
        code: 'ENODE_WEBHOOK_INVALID',
        message: 'Webhook source IP is not allowlisted.',
        status: 401,
      });
    }
  }

  const container = getContainer();
  const arrayBuffer = await request.arrayBuffer();
  const rawBody = Buffer.from(arrayBuffer);

  if (rawBody.byteLength > env.WEBHOOK_MAX_BODY_BYTES) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Webhook body too large.',
      status: 413,
    });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (
      key.toLowerCase() === 'authorization' ||
      key.toLowerCase().includes('secret')
    ) {
      return;
    }
    headers[key] = value;
  });

  const signature =
    request.headers.get('x-enode-signature') ??
    request.headers.get('x-webhook-signature');
  const deliveryHeader = request.headers.get('x-enode-delivery');

  const result = await receiveEnodeWebhook({
    db: container.db,
    rawBody,
    headers,
    signatureHeader: signature,
    deliveryHeader,
  });

  // Acknowledge quickly; processing is asynchronous via outbox.
  return jsonOk(
    {
      status: result.duplicate ? 'duplicate' : 'accepted',
      deliveryId: createHash('sha256')
        .update(result.deliveryId)
        .digest('hex')
        .slice(0, 16),
    },
    context.requestId,
    { status: result.duplicate ? 200 : 202 },
  );
});
