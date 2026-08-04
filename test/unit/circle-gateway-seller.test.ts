import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ARC_TESTNET_CAIP2,
  GATEWAY_BATCHING_EXTRA_NAME,
} from '@/server/config/circle';
import { resetServerEnvCache } from '@/server/config/env';
import type { CirclePaymentRequirements } from '@/server/domain/payments/circle-gateway';
import {
  createCircleGatewaySeller,
  createMockCircleGatewaySeller,
  type CircleFacilitatorPort,
} from '@/server/infrastructure/payments/circle-gateway-seller';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

function sampleRequirements(
  seller: ReturnType<typeof createCircleGatewaySeller>,
): CirclePaymentRequirements {
  const [requirements] = seller.buildPaymentRequired({
    resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    description: 'test',
    amountAtomic: '400',
    payTo: '0x1111111111111111111111111111111111111111',
    asset: '0x3600000000000000000000000000000000000000',
    network: ARC_TESTNET_CAIP2,
    verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
    maxTimeoutSeconds: 900,
  }).accepts;
  if (requirements === undefined) {
    throw new Error('expected payment requirements');
  }
  return requirements;
}

describe('circle gateway seller', () => {
  const previous = {
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    API_KEY_HASH_SECRET: process.env.API_KEY_HASH_SECRET,
    SELLER_WALLET_ADDRESS: process.env.SELLER_WALLET_ADDRESS,
  };

  beforeEach(() => {
    setEnv('APP_ENV', 'test');
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
    );
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('SELLER_WALLET_ADDRESS', undefined);
    resetServerEnvCache();
  });

  afterEach(() => {
    setEnv('ALLOW_MOCK_ADAPTERS', previous.ALLOW_MOCK_ADAPTERS);
    setEnv('APP_ENV', previous.APP_ENV);
    setEnv('DATABASE_URL', previous.DATABASE_URL);
    setEnv('API_KEY_HASH_SECRET', previous.API_KEY_HASH_SECRET);
    setEnv('SELLER_WALLET_ADDRESS', previous.SELLER_WALLET_ADDRESS);
    resetServerEnvCache();
  });

  it('settles successfully via an injected facilitator double', async () => {
    const facilitator: CircleFacilitatorPort = {
      async settle() {
        return {
          success: true,
          transaction:
            '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          payer: '0xdddddddddddddddddddddddddddddddddddddddd',
        };
      },
    };

    const seller = createCircleGatewaySeller({ facilitator });
    const requirements = sampleRequirements(seller);
    expect(requirements.extra.name).toBe(GATEWAY_BATCHING_EXTRA_NAME);

    const signature = Buffer.from(
      JSON.stringify({ accepted: requirements }),
      'utf8',
    ).toString('base64');

    const result = await seller.settle({
      paymentSignatureHeader: signature,
      requirements,
    });

    expect(result).toEqual({
      success: true,
      transactionHash:
        '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      payer: '0xdddddddddddddddddddddddddddddddddddddddd',
      network: ARC_TESTNET_CAIP2,
    });
  });

  it('maps facilitator success:false to settlement failure', async () => {
    const facilitator: CircleFacilitatorPort = {
      async settle() {
        return { success: false, errorReason: 'insufficient_funds' };
      },
    };
    const seller = createCircleGatewaySeller({ facilitator });
    const requirements = sampleRequirements(seller);

    const result = await seller.settle({
      paymentSignatureHeader: Buffer.from('{"ok":true}', 'utf8').toString(
        'base64',
      ),
      requirements,
    });
    expect(result).toEqual({
      success: false,
      code: 'PAYMENT_SETTLEMENT_FAILED',
      message: 'Circle Gateway settlement failed.',
    });
  });

  it('maps facilitator throws to PAYMENT_VERIFICATION_UNAVAILABLE', async () => {
    const facilitator: CircleFacilitatorPort = {
      async settle() {
        throw new Error('facilitator down');
      },
    };
    const seller = createCircleGatewaySeller({ facilitator });
    const requirements = sampleRequirements(seller);

    const result = await seller.settle({
      paymentSignatureHeader: Buffer.from('{"ok":true}', 'utf8').toString(
        'base64',
      ),
      requirements,
    });
    expect(result).toEqual({
      success: false,
      code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
      message: 'Circle Gateway settlement is unavailable.',
    });
  });

  it('forbids mock seller when ALLOW_MOCK_ADAPTERS is false', () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    resetServerEnvCache();
    expect(() => createMockCircleGatewaySeller()).toThrow(/Mock Circle seller/);
  });
});
