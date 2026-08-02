import { describe, expect, it } from 'vitest';

import {
  ARC_TESTNET_CAIP2,
  GATEWAY_BATCHING_EXTRA_NAME,
} from '@/server/config/circle';
import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import {
  buildCanonicalTelemetryDocument,
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
} from '@/server/domain/telemetry/canonical';
import {
  createMockCircleGatewaySeller,
  findGatewayBatchingOption,
  parsePaymentRequiredHeader,
} from '@/server/infrastructure/payments/circle-gateway-seller';

describe('canonical telemetry hashing', () => {
  it('produces a stable SHA-256 for the same logical record', () => {
    const document = buildCanonicalTelemetryDocument({
      deviceId: '11111111-1111-1111-1111-111111111111',
      source: 'enode',
      sourceObservedAt: new Date('2026-01-01T00:00:00.000Z'),
      recordedAt: new Date('2026-01-01T00:00:00.000Z'),
      receivedAt: new Date('2026-01-01T00:00:01.000Z'),
      data: {
        stateOfChargePercent: 80,
        isCharging: true,
        isPluggedIn: true,
        rangeKilometers: 250,
        odometerKilometers: 1000,
        chargeRateKilowatts: 11,
        powerKilowatts: null,
        latitude: null,
        longitude: null,
      },
    });

    const json = canonicalizeTelemetry(document);
    const again = canonicalizeTelemetry(document);
    expect(json).toBe(again);

    const hash = hashCanonicalTelemetry(json);
    expect(hash.algorithm).toBe('SHA-256');
    expect(hash.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCanonicalTelemetry(json).contentHash).toBe(hash.contentHash);
  });
});

describe('circle payment-required header codec', () => {
  it('encodes and finds GatewayWalletBatched options', () => {
    resetServerEnvCache();
    parseServerEnv({
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test',
      API_KEY_HASH_SECRET: 'test-api-key-hash-secret-32chars!!',
      APP_ENV: 'test',
      ALLOW_MOCK_ADAPTERS: 'true',
    });

    const seller = createMockCircleGatewaySeller();
    const body = seller.buildPaymentRequired({
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
      description: 'Latest EV telemetry record',
      amountAtomic: '400',
      payTo: '0x1111111111111111111111111111111111111111',
      asset: '0x3600000000000000000000000000000000000000',
      network: ARC_TESTNET_CAIP2,
      verifyingContract: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
      maxTimeoutSeconds: 604900,
    });

    const header = seller.encodePaymentRequiredHeader(body);
    const parsed = parsePaymentRequiredHeader(header);
    const option = findGatewayBatchingOption(parsed);
    expect(option?.extra.name).toBe(GATEWAY_BATCHING_EXTRA_NAME);
    expect(option?.amount).toBe('400');
  });
});
