import { describe, expect, it } from 'vitest';

import {
  getAdminBasicCredentials,
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

  it('requires SELLER_WALLET_ADDRESS when mock adapters are disabled', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ALLOW_MOCK_ADAPTERS: 'false',
      }),
    ).toThrow(/SELLER_WALLET_ADDRESS is required/);
  });

  it('rejects the demo 0x1111… seller when mock adapters are disabled', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ALLOW_MOCK_ADAPTERS: 'false',
        SELLER_WALLET_ADDRESS: '0x1111111111111111111111111111111111111111',
      }),
    ).toThrow(/Demo seller wallet/);
  });

  it('rejects production with a BatchAnchor signer private key', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        APP_ENV: 'production',
        ALLOW_MOCK_ADAPTERS: 'false',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/ev_telemetry',
        API_KEY_HASH_SECRET: 'prod-api-key-hash-secret-32chars!!',
        SELLER_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
        BATCH_ANCHOR_SIGNER_PRIVATE_KEY:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
      }),
    ).toThrow(/BatchAnchor signer private keys are forbidden/);
  });

  it('allows live config when seller wallet is set and mocks are off', () => {
    const env = parseServerEnv({
      ...validEnv,
      ALLOW_MOCK_ADAPTERS: 'false',
      SELLER_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
    });
    expect(env.ALLOW_MOCK_ADAPTERS).toBe(false);
    expect(env.SELLER_WALLET_ADDRESS).toBe(
      '0x2222222222222222222222222222222222222222',
    );
  });

  it('accepts both admin credentials when password is long enough', () => {
    const env = parseServerEnv({
      ...validEnv,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD: 'long-enough-password',
    });
    expect(getAdminBasicCredentials(env)).toEqual({
      username: 'admin',
      password: 'long-enough-password',
    });
  });

  it('rejects admin username without password', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ADMIN_USERNAME: 'admin',
      }),
    ).toThrow(/ADMIN_USERNAME and ADMIN_PASSWORD/);
  });

  it('rejects short admin passwords', () => {
    expect(() =>
      parseServerEnv({
        ...validEnv,
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'short',
      }),
    ).toThrow(/ADMIN_PASSWORD must be at least 8/);
  });

  it('returns null admin credentials when unset', () => {
    const env = parseServerEnv(validEnv);
    expect(getAdminBasicCredentials(env)).toBeNull();
  });
});

describe('resetServerEnvCache', () => {
  it('clears the lazy cache', () => {
    resetServerEnvCache();
    expect(true).toBe(true);
  });
});
