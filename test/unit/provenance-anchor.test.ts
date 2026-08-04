import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import {
  createMockProvenanceAnchor,
  createProvenanceAnchorForEnv,
} from '@/server/infrastructure/blockchain/provenance-anchor';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

describe('provenance anchor adapters', () => {
  const previous = {
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    API_KEY_HASH_SECRET: process.env.API_KEY_HASH_SECRET,
    BATCH_ANCHOR_CONTRACT_ADDRESS: process.env.BATCH_ANCHOR_CONTRACT_ADDRESS,
  };

  beforeEach(() => {
    setEnv('APP_ENV', 'test');
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
    );
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('BATCH_ANCHOR_CONTRACT_ADDRESS', undefined);
    resetServerEnvCache();
  });

  afterEach(() => {
    setEnv('ALLOW_MOCK_ADAPTERS', previous.ALLOW_MOCK_ADAPTERS);
    setEnv('APP_ENV', previous.APP_ENV);
    setEnv('DATABASE_URL', previous.DATABASE_URL);
    setEnv('API_KEY_HASH_SECRET', previous.API_KEY_HASH_SECRET);
    setEnv(
      'BATCH_ANCHOR_CONTRACT_ADDRESS',
      previous.BATCH_ANCHOR_CONTRACT_ADDRESS,
    );
    resetServerEnvCache();
  });

  it('mock adapter submits a deterministic tx hash and verifies', async () => {
    const anchor = createMockProvenanceAnchor();
    const contentHash =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const submitted = await anchor.anchorTelemetry({
      contentHash,
      telemetryRecordId: '00000000-0000-0000-0000-000000000001',
    });
    expect(submitted.status).toBe('submitted');
    expect(submitted.transactionHash).toMatch(/^0x[a-f0-9]{64}$/);

    const verified = await anchor.verifyAnchor({
      contentHash,
      anchorTransactionHash: submitted.transactionHash,
    });
    expect(verified.valid).toBe(true);
  });

  it('forbids mock adapter when ALLOW_MOCK_ADAPTERS is false', () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    resetServerEnvCache();
    expect(() => createMockProvenanceAnchor()).toThrow(/ALLOW_MOCK_ADAPTERS/);
  });

  it('selects mock via createProvenanceAnchorForEnv when mocks allowed', async () => {
    const anchor = createProvenanceAnchorForEnv();
    const result = await anchor.anchorTelemetry({
      contentHash:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      telemetryRecordId: '00000000-0000-0000-0000-000000000002',
    });
    expect(result.status).toBe('submitted');
  });

  it('fail-closes when mocks off and contract unset', async () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    setEnv('BATCH_ANCHOR_CONTRACT_ADDRESS', undefined);
    resetServerEnvCache();
    const anchor = createProvenanceAnchorForEnv();
    await expect(
      anchor.anchorTelemetry({
        contentHash:
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        telemetryRecordId: '00000000-0000-0000-0000-000000000003',
      }),
    ).rejects.toThrow(/BatchAnchor is not configured/);
  });
});
