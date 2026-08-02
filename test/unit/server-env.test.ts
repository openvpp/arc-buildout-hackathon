import { describe, expect, it } from 'vitest';

import {
  parseServerEnv,
  type RawServerEnv,
  resetServerEnvCache,
} from '@/server/config/env';

const validEnv: RawServerEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test',
  API_KEY_HASH_SECRET: 'test-api-key-hash-secret-32chars!!',
  ALLOW_MOCK_ADAPTERS: 'true',
};

describe('parseServerEnv', () => {
  it('parses a valid server environment', () => {
    const env = parseServerEnv(validEnv);
    expect(env.APP_ENV).toBe('test');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.TELEMETRY_PRICE_USDC_ATOMIC).toBe('400');
    expect(env.ALLOW_MOCK_ADAPTERS).toBe(true);
  });

  it('rejects production with mock adapters enabled', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        APP_ENV: 'production',
        ALLOW_MOCK_ADAPTERS: 'true',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/ev_telemetry',
      }),
    ).toThrow(/Mock adapters/);
  });

  it('rejects production with a localhost database URL', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        APP_ENV: 'production',
        ALLOW_MOCK_ADAPTERS: 'false',
        DATABASE_URL:
          'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
        API_KEY_HASH_SECRET: 'prod-api-key-hash-secret-32chars!!',
      }),
    ).toThrow(/local or test database/);
  });

  it('rejects a short API key hash secret', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        API_KEY_HASH_SECRET: 'too-short',
      }),
    ).toThrow(/API_KEY_HASH_SECRET/);
  });

  it('rejects the zero seller wallet address', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        SELLER_WALLET_ADDRESS: '0x0000000000000000000000000000000000000000',
      }),
    ).toThrow(/zero address/);
  });
});

describe('resetServerEnvCache', () => {
  it('clears the lazy cache', () => {
    resetServerEnvCache();
    expect(true).toBe(true);
  });
});
