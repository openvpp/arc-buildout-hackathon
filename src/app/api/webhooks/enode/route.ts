import { createHash } from 'node:crypto';

import { receiveEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = createRouteHandler(async (request, context) => {
  const env = getServerEnv();
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

  const result = await receiveEnodeWebhook({
    db: container.db,
    outbox: container.outbox,
    rawBody,
    headers,
    signatureHeader: signature,
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
