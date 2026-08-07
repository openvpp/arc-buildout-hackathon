import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import {
  isCircleTransferUuid,
  isOnchainTxHash,
  resolveCircleX402TransferTxHash,
} from '@/server/infrastructure/payments/circle-x402-transfer';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

describe('circle x402 transfer helpers', () => {
  it('detects on-chain settlement hashes', () => {
    expect(
      isOnchainTxHash(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(true);
    expect(isOnchainTxHash('not-a-hash')).toBe(false);
    expect(isOnchainTxHash('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(false);
  });

  it('detects Circle transfer UUIDs', () => {
    expect(isCircleTransferUuid('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(
      true,
    );
    expect(isCircleTransferUuid('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(
      true,
    );
    expect(
      isCircleTransferUuid(
        '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ),
    ).toBe(false);
  });
});

describe('resolveCircleX402TransferTxHash', () => {
  const previous = {
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    API_KEY_HASH_SECRET: process.env.API_KEY_HASH_SECRET,
    CIRCLE_GATEWAY_AUTH_TOKEN: process.env.CIRCLE_GATEWAY_AUTH_TOKEN,
    CIRCLE_GATEWAY_FACILITATOR_URL: process.env.CIRCLE_GATEWAY_FACILITATOR_URL,
  };

  beforeEach(() => {
    setEnv('APP_ENV', 'test');
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
    );
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
    setEnv('CIRCLE_GATEWAY_AUTH_TOKEN', 'test-circle-token');
    setEnv('CIRCLE_GATEWAY_FACILITATOR_URL', 'https://gateway.example.test');
    resetServerEnvCache();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    setEnv('APP_ENV', previous.APP_ENV);
    setEnv('DATABASE_URL', previous.DATABASE_URL);
    setEnv('API_KEY_HASH_SECRET', previous.API_KEY_HASH_SECRET);
    setEnv('CIRCLE_GATEWAY_AUTH_TOKEN', previous.CIRCLE_GATEWAY_AUTH_TOKEN);
    setEnv(
      'CIRCLE_GATEWAY_FACILITATOR_URL',
      previous.CIRCLE_GATEWAY_FACILITATOR_URL,
    );
    resetServerEnvCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null when auth token is missing', async () => {
    setEnv('CIRCLE_GATEWAY_AUTH_TOKEN', undefined);
    resetServerEnvCache();
    await expect(
      resolveCircleX402TransferTxHash('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the settlement txHash when Circle has assigned one', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          status: 'SETTLED',
          txHash:
            '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(
      resolveCircleX402TransferTxHash('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).resolves.toBe(
      '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/x402/transfers/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-circle-token',
        }),
      }),
    );
  });

  it('returns null while Circle has not published a tx hash', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: 'PENDING', txHash: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      resolveCircleX402TransferTxHash('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).resolves.toBeNull();
  });
});
