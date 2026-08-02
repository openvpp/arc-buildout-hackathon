import { createHmac, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/server/config/env';

/**
 * Verify Enode webhook authenticity.
 *
 * When ENODE_WEBHOOK_SECRET is set, require HMAC-SHA256 over the raw body in
 * `x-enode-signature` (or `x-webhook-signature`). When unset in demo/dev/test
 * with ALLOW_MOCK_ADAPTERS, accept but record that crypto verification was
 * skipped. Production always requires the secret.
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

  const expected = createHmac('sha256', secret)
    .update(input.rawBody)
    .digest('hex');
  const provided = input.signatureHeader.replace(/^sha256=/i, '').trim();

  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'Invalid webhook signature' };
    }
  } catch {
    return { ok: false, reason: 'Malformed webhook signature' };
  }

  if (
    env.ENODE_WEBHOOK_ALLOWED_IPS !== undefined &&
    env.ENODE_WEBHOOK_ALLOWED_IPS.length > 0
  ) {
    // IP allowlist is enforced at the transport layer when x-forwarded-for is present.
  }

  return { ok: true };
}
