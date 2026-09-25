import { NextResponse } from 'next/server';

import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import { getServerEnv } from '@/server/config/env';
import { getDb } from '@/server/infrastructure/db/client';
import { verifyEnodeWebhookSignature } from '@/server/infrastructure/enode/webhook-verifier';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createServerLogger({ component: 'enode-webhook-route' });

/**
 * POST /api/webhooks/enode — verify, dedupe, and process an Enode webhook
 * delivery. Always returns quickly; unknown event types never crash
 * ingestion. Never logs the full raw body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  const env = getServerEnv();
  const secret = env.ENODE_WEBHOOK_SECRET;

  const signatureValid =
    secret !== undefined &&
    secret.length > 0 &&
    verifyEnodeWebhookSignature({
      rawBody,
      signatureHeader: request.headers.get('x-enode-signature'),
      secret,
    });

  if (!signatureValid) {
    log.warn('enode.webhook.invalid_signature', {});
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const db = getDb();
  const result = await processEnodeWebhook(db, {
    rawBody,
    deliveryIdHeader: request.headers.get('x-enode-delivery'),
    signatureValid: true,
  });

  return NextResponse.json(
    { ok: true, status: result.status },
    { status: 202 },
  );
}
