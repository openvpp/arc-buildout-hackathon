import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyEnodeWebhookSignature } from '@/server/infrastructure/enode/webhook-verifier';

describe('verifyEnodeWebhookSignature', () => {
  const secret = 'example-secret';
  const rawBody = JSON.stringify({ payload: 'example' });

  it('accepts a correctly signed body (matches Enode docs example)', () => {
    const signature = `sha1=${createHmac('sha1', secret).update(rawBody).digest('hex')}`;
    expect(
      verifyEnodeWebhookSignature({
        rawBody,
        signatureHeader: signature,
        secret,
      }),
    ).toBe(true);
  });

  it('matches the documented Enode fixture hash exactly', () => {
    expect(
      verifyEnodeWebhookSignature({
        rawBody,
        signatureHeader: 'sha1=e417e6fc2e7f8a78c93a35a7b344d36ce179fc8d',
        secret,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = `sha1=${createHmac('sha1', secret).update(rawBody).digest('hex')}`;
    expect(
      verifyEnodeWebhookSignature({
        rawBody: JSON.stringify({ payload: 'tampered' }),
        signatureHeader: signature,
        secret,
      }),
    ).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(
      verifyEnodeWebhookSignature({ rawBody, signatureHeader: null, secret }),
    ).toBe(false);
  });

  it('rejects a malformed signature scheme', () => {
    expect(
      verifyEnodeWebhookSignature({
        rawBody,
        signatureHeader: 'sha256=deadbeef',
        secret,
      }),
    ).toBe(false);
  });
});
