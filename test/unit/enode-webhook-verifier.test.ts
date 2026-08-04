import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import {
  signEnodeWebhookBody,
  verifyEnodeWebhook,
} from '@/server/infrastructure/enode/webhook-verifier';

function setEnv(key: string, value: string | undefined): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('enode webhook verifier', () => {
  const previous = {
    ENODE_WEBHOOK_SECRET: process.env.ENODE_WEBHOOK_SECRET,
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
  };

  beforeEach(() => {
    resetServerEnvCache();
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
  });

  afterEach(() => {
    setEnv('ENODE_WEBHOOK_SECRET', previous.ENODE_WEBHOOK_SECRET);
    setEnv('ALLOW_MOCK_ADAPTERS', previous.ALLOW_MOCK_ADAPTERS);
    setEnv('APP_ENV', previous.APP_ENV);
    resetServerEnvCache();
  });

  it('accepts Enode docs example vector (HMAC-SHA1)', () => {
    setEnv('ENODE_WEBHOOK_SECRET', 'example-secret');
    resetServerEnvCache();

    const rawBody = Buffer.from('{"payload":"example"}', 'utf8');
    const result = verifyEnodeWebhook({
      rawBody,
      signatureHeader: 'sha1=e417e6fc2e7f8a78c93a35a7b344d36ce179fc8d',
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects wrong signature', () => {
    setEnv('ENODE_WEBHOOK_SECRET', 'example-secret');
    resetServerEnvCache();

    const rawBody = Buffer.from('{"payload":"example"}', 'utf8');
    const result = verifyEnodeWebhook({
      rawBody,
      signatureHeader: 'sha1=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(result.ok).toBe(false);
  });

  it('signEnodeWebhookBody matches verifier', () => {
    setEnv('ENODE_WEBHOOK_SECRET', 'local-test-secret');
    resetServerEnvCache();

    const rawBody = Buffer.from('[{"event":"enode:webhook:test"}]', 'utf8');
    const signature = signEnodeWebhookBody(rawBody, 'local-test-secret');
    expect(verifyEnodeWebhook({ rawBody, signatureHeader: signature })).toEqual(
      { ok: true },
    );
  });
});
