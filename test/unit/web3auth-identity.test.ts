import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import { ApiError } from '@/server/transport/http/api-error';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

describe('verifyWeb3AuthIdentity mock path', () => {
  const previous = {
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    API_KEY_HASH_SECRET: process.env.API_KEY_HASH_SECRET,
    WEB3AUTH_CLIENT_ID: process.env.WEB3AUTH_CLIENT_ID,
  };

  beforeEach(() => {
    setEnv('APP_ENV', 'test');
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
    );
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('WEB3AUTH_CLIENT_ID', undefined);
    resetServerEnvCache();
  });

  afterEach(() => {
    setEnv('ALLOW_MOCK_ADAPTERS', previous.ALLOW_MOCK_ADAPTERS);
    setEnv('APP_ENV', previous.APP_ENV);
    setEnv('DATABASE_URL', previous.DATABASE_URL);
    setEnv('API_KEY_HASH_SECRET', previous.API_KEY_HASH_SECRET);
    setEnv('WEB3AUTH_CLIENT_ID', previous.WEB3AUTH_CLIENT_ID);
    resetServerEnvCache();
  });

  it('accepts Bearer mock:0x… when mocks are enabled', async () => {
    const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const identity = await verifyWeb3AuthIdentity({
      authorizationHeader: `Bearer mock:${address}`,
      claimedWalletAddress: address,
    });
    expect(identity.walletAddress).toBe(address);
    expect(identity.subject).toBe(`mock:${address}`);
  });

  it('uses mock token wallet even when claimed address differs', async () => {
    const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const identity = await verifyWeb3AuthIdentity({
      authorizationHeader: `Bearer mock:${address}`,
      claimedWalletAddress: '0x1111111111111111111111111111111111111111',
    });
    expect(identity.walletAddress).toBe(address);
  });

  it('rejects missing Authorization', async () => {
    await expect(
      verifyWeb3AuthIdentity({
        authorizationHeader: null,
        claimedWalletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
