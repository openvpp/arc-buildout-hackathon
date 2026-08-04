import { createHmac, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/server/config/env';

/**
 * Verify Enode webhook authenticity.
 *
 * Enode signs the raw body with HMAC-SHA1 and sends
 * `x-enode-signature: sha1=<hex>` (see Enode webhook docs).
 *
 * When ENODE_WEBHOOK_SECRET is unset in demo/dev/test with
 * ALLOW_MOCK_ADAPTERS, accept but record that crypto verification was
 * skipped. Production/staging always require the secret.
 */
export function verifyEnodeWebhook(input: {
  rawBody: Buffer;
  signatureHeader: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const env = getServerEnv();
  const secret = env.ENODE_WEBHOOK_SECRET;

  if (secret === undefined || secret.length === 0) {
    if (
      env.APP_ENV === 'production' ||
      env.APP_ENV === 'staging' ||
      !env.ALLOW_MOCK_ADAPTERS
    ) {
      return { ok: false, reason: 'ENODE_WEBHOOK_SECRET is not configured' };
    }
    return { ok: true };
  }

  if (input.signatureHeader === null || input.signatureHeader.length === 0) {
    return { ok: false, reason: 'Missing webhook signature header' };
  }

  const provided = input.signatureHeader.trim();
  const expected = `sha1=${createHmac('sha1', secret)
    .update(input.rawBody)
    .digest('hex')}`;

  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(provided, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Invalid webhook signature' };
    }
  } catch {
    return { ok: false, reason: 'Malformed webhook signature' };
  }

  return { ok: true };
}

/** Compute Enode-style signature for tests / local fixtures. */
export function signEnodeWebhookBody(rawBody: Buffer, secret: string): string {
  return `sha1=${createHmac('sha1', secret).update(rawBody).digest('hex')}`;
}
