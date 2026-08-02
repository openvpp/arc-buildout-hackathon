/**
 * Integration coverage for Circle Gateway settle → ledger/delivery with a
 * facilitator test double. Requires Postgres (pnpm services:up).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { beforeAll, describe, expect, it } from 'vitest';

import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createPrincipalRepository } from '@/server/infrastructure/db/repositories/principal-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import {
  ledgerEntries,
  principalWallets,
  telemetryDeliveries,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { createMockCircleGatewaySeller } from '@/server/infrastructure/payments/circle-gateway-seller';
import { createConfiguredPricingPolicy } from '@/server/infrastructure/payments/pricing-policy';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('circle gateway latest-telemetry integration', () => {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });

  beforeAll(async () => {
    resetServerEnvCache();
    setEnv('DATABASE_URL', databaseUrl);
    setEnv('API_KEY_HASH_SECRET', hashSecret);
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('TELEMETRY_PRICE_USDC_ATOMIC', '400');
    parseServerEnv({
      DATABASE_URL: databaseUrl,
      API_KEY_HASH_SECRET: hashSecret,
      APP_ENV: 'test',
      ALLOW_MOCK_ADAPTERS: 'true',
      TELEMETRY_PRICE_USDC_ATOMIC: '400',
    });

    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await sql`create extension if not exists pgcrypto`;
    await migrate(db, { migrationsFolder: './drizzle/migrations' });
  }, 60_000);

  it('returns 402 then settles once and advances cursor (mock Circle)', async () => {
    const principals = createPrincipalRepository(db);
    const wallets = createWalletRepository(db);
    const devices = createDeviceRepository(db);
    const pricing = createConfiguredPricingPolicy();
    const circleSeller = createMockCircleGatewaySeller();

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Circle Integration Agent',
    });
    const address = '0x4444444444444444444444444444444444444444';
    const wallet = await wallets.create({
      chainId: 5042002n,
      address,
      normalizedAddress: normalizeEvmAddress(address),
    });
    await db.insert(principalWallets).values({
      principalId: principal.id,
      walletId: wallet.id,
      role: 'agent',
    });
    const device = await devices.create({
      walletId: wallet.id,
      externalDeviceId: `circle-device-${principal.id}`,
      displayName: 'Circle Test EV',
    });

    const recordedAt = new Date('2026-06-01T12:00:00.000Z');
    const [record] = await db
      .insert(telemetryRecords)
      .values({
        deviceId: device.id,
        source: 'enode',
        receivedAt: recordedAt,
        recordedAt,
        schemaVersion: '1.0.0',
        telemetryPayload: {
          stateOfChargePercent: 55,
          isCharging: false,
        },
        canonicalPayload: { v: 1 },
        canonicalizationVersion: 'v1',
        contentHashAlgorithm: 'SHA-256',
        contentHash: `hash-${principal.id}`,
        dataOrigin: 'ENODE_SANDBOX',
      })
      .returning();

    expect(record).toBeDefined();
    if (record === undefined) {
      throw new Error('expected telemetry record');
    }

    const auth: AuthenticatedPrincipal = {
      principalId: principal.id,
      principalType: 'autonomous_agent',
      credentialId: '00000000-0000-0000-0000-000000000099',
      scopes: ['telemetry:request', 'payment:submit'],
      keyPrefix: 'test',
    };

    const first = await requestLatestTelemetry({
      db,
      principal: auth,
      pricing,
      circleSeller,
      walletAddress: address,
      deviceId: device.id,
      paymentSignatureHeader: null,
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    });
    expect(first.kind).toBe('PAYMENT_REQUIRED');
    if (first.kind !== 'PAYMENT_REQUIRED') {
      return;
    }
    expect(first.paymentRequiredHeader.length).toBeGreaterThan(10);

    const second = await requestLatestTelemetry({
      db,
      principal: auth,
      pricing,
      circleSeller,
      walletAddress: address,
      deviceId: device.id,
      paymentSignatureHeader: Buffer.from(
        JSON.stringify({ mock: true }),
        'utf8',
      ).toString('base64'),
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    });
    expect(second.kind).toBe('TELEMETRY_DELIVERED');
    if (second.kind !== 'TELEMETRY_DELIVERED') {
      return;
    }
    expect(second.payment.transactionHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(second.provenance.contentHash).toBe(record.contentHash);

    const deliveries = await db
      .select()
      .from(telemetryDeliveries)
      .where(eq(telemetryDeliveries.telemetryRecordId, record.id));
    expect(deliveries).toHaveLength(1);

    const ledger = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, wallet.id));
    expect(ledger.length).toBeGreaterThanOrEqual(1);

    const third = await requestLatestTelemetry({
      db,
      principal: auth,
      pricing,
      circleSeller,
      walletAddress: address,
      deviceId: device.id,
      paymentSignatureHeader: null,
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    });
    expect(third.kind).toBe('NO_NEW_RECORD');
  });
});
