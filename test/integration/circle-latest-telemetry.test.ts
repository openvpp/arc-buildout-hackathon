/**
 * Integration coverage for Circle Gateway settle → ledger/delivery with a
 * facilitator test double. Requires Postgres (pnpm services:up).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createPrincipalRepository } from '@/server/infrastructure/db/repositories/principal-repository';
import {
  creditAndDeliver,
  PaymentTransactionReuseError,
} from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import {
  agentDeviceCursors,
  ledgerEntries,
  paymentRequirements,
  paymentTransactions,
  principalWallets,
  telemetryDeliveries,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { createMockCircleGatewaySeller } from '@/server/infrastructure/payments/circle-gateway-seller';
import { createConfiguredPricingPolicy } from '@/server/infrastructure/payments/pricing-policy';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

async function seedAgentPurchaseFixture(db: Database) {
  const principals = createPrincipalRepository(db);
  const wallets = createWalletRepository(db);
  const devices = createDeviceRepository(db);

  const principal = await principals.create({
    type: 'autonomous_agent',
    displayName: `Circle Agent ${crypto.randomUUID()}`,
  });
  const address = `0x${crypto.randomUUID().replaceAll('-', '').slice(0, 40)}`;
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

  return { address, auth, device, principal, record, wallet };
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
    setEnv('PROVENANCE_DELIVERY_MODE', 'pending');
    parseServerEnv({
      DATABASE_URL: databaseUrl,
      API_KEY_HASH_SECRET: hashSecret,
      APP_ENV: 'test',
      ALLOW_MOCK_ADAPTERS: 'true',
      TELEMETRY_PRICE_USDC_ATOMIC: '400',
      PROVENANCE_DELIVERY_MODE: 'pending',
    });

    await resetAndMigrateTestDatabase(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('returns 402 then settles once and advances cursor (mock Circle)', async () => {
    const pricing = createConfiguredPricingPolicy();
    const circleSeller = createMockCircleGatewaySeller();
    const { address, auth, device, record, wallet } =
      await seedAgentPurchaseFixture(db);

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

  it('redelivers purchased telemetry with the stored settlement hash', async () => {
    const pricing = createConfiguredPricingPolicy();
    const circleSeller = createMockCircleGatewaySeller();
    const { address, auth, device } = await seedAgentPurchaseFixture(db);

    const paid = await requestLatestTelemetry({
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
    expect(paid.kind).toBe('TELEMETRY_DELIVERED');
    if (paid.kind !== 'TELEMETRY_DELIVERED') {
      return;
    }

    await db
      .delete(agentDeviceCursors)
      .where(eq(agentDeviceCursors.principalId, auth.principalId));

    const redelivered = await requestLatestTelemetry({
      db,
      principal: auth,
      pricing,
      circleSeller,
      walletAddress: address,
      deviceId: device.id,
      paymentSignatureHeader: null,
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    });
    expect(redelivered.kind).toBe('TELEMETRY_DELIVERED');
    if (redelivered.kind !== 'TELEMETRY_DELIVERED') {
      return;
    }
    expect(redelivered.payment.transactionHash).toBe(
      paid.payment.transactionHash,
    );
    expect(redelivered.payment.transactionHash.length).toBeGreaterThan(0);
    expect(redelivered.deliveryId).toBe(paid.deliveryId);
  });

  it('credits ledger and delivery exactly once under concurrent settle', async () => {
    const pricing = createConfiguredPricingPolicy();
    const circleSeller = createMockCircleGatewaySeller();
    const { address, auth, device, record, wallet } =
      await seedAgentPurchaseFixture(db);

    const quote = await requestLatestTelemetry({
      db,
      principal: auth,
      pricing,
      circleSeller,
      walletAddress: address,
      deviceId: device.id,
      paymentSignatureHeader: null,
      resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
    });
    expect(quote.kind).toBe('PAYMENT_REQUIRED');

    const paymentSignatureHeader = Buffer.from(
      JSON.stringify({ mock: true }),
      'utf8',
    ).toString('base64');

    const results = await Promise.all([
      requestLatestTelemetry({
        db,
        principal: auth,
        pricing,
        circleSeller,
        walletAddress: address,
        deviceId: device.id,
        paymentSignatureHeader,
        resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
      }),
      requestLatestTelemetry({
        db,
        principal: auth,
        pricing,
        circleSeller,
        walletAddress: address,
        deviceId: device.id,
        paymentSignatureHeader,
        resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
      }),
    ]);

    expect(results.map((result) => result.kind)).toEqual([
      'TELEMETRY_DELIVERED',
      'TELEMETRY_DELIVERED',
    ]);
    const hashes = results.flatMap((result) =>
      result.kind === 'TELEMETRY_DELIVERED'
        ? [result.payment.transactionHash]
        : [],
    );
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toMatch(/^0x[a-f0-9]{64}$/);
    expect(hashes[0]).toBe(hashes[1]);

    const deliveries = await db
      .select()
      .from(telemetryDeliveries)
      .where(eq(telemetryDeliveries.telemetryRecordId, record.id));
    expect(deliveries).toHaveLength(1);

    const credits = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.walletId, wallet.id));
    expect(
      credits.filter((row) => row.entryType === 'payment_credit'),
    ).toHaveLength(1);
    expect(
      credits.filter((row) => row.entryType === 'telemetry_charge'),
    ).toHaveLength(1);

    const txs = await db.select().from(paymentTransactions);
    expect(txs.filter((row) => row.transactionHash === hashes[0])).toHaveLength(
      1,
    );
  });

  it('rejects settlement transaction reuse across payment requirements', async () => {
    const {
      address: _address,
      auth,
      device,
      record,
      wallet,
    } = await seedAgentPurchaseFixture(db);

    const expiresAt = new Date(Date.now() + 60_000);
    const [requirementA] = await db
      .insert(paymentRequirements)
      .values({
        principalId: auth.principalId,
        walletId: wallet.id,
        deviceId: device.id,
        telemetryRecordId: record.id,
        pricingVersion: 'test',
        network: 'arc-testnet',
        chainId: 5042002n,
        asset: 'USDC',
        tokenContractAddress: '0x3600000000000000000000000000000000000000',
        amountAtomic: '400',
        amountDisplay: '0.0004',
        decimals: 6,
        sellerWalletAddress: '0x1111111111111111111111111111111111111111',
        payerWalletAddress: wallet.address,
        status: 'pending',
        expiresAt,
      })
      .returning();
    if (requirementA === undefined) {
      throw new Error('expected requirement A');
    }

    const sharedHash =
      '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    await creditAndDeliver({
      db,
      principalId: auth.principalId,
      walletId: wallet.id,
      deviceId: device.id,
      telemetryRecordId: record.id,
      paymentRequirementId: requirementA.id,
      chainId: 5042002n,
      amountAtomic: '400',
      asset: 'USDC',
      transactionHash: sharedHash,
      payerAddress: wallet.address,
      tokenContractAddress: '0x3600000000000000000000000000000000000000',
    });

    const secondPrincipal = createPrincipalRepository(db);
    const other = await secondPrincipal.create({
      type: 'autonomous_agent',
      displayName: `Reuse Agent ${crypto.randomUUID()}`,
    });
    await db.insert(principalWallets).values({
      principalId: other.id,
      walletId: wallet.id,
      role: 'agent',
    });

    const recordedAt = new Date('2026-06-02T12:00:00.000Z');
    const [otherRecord] = await db
      .insert(telemetryRecords)
      .values({
        deviceId: device.id,
        source: 'enode',
        receivedAt: recordedAt,
        recordedAt,
        schemaVersion: '1.0.0',
        telemetryPayload: { stateOfChargePercent: 40 },
        canonicalPayload: { v: 1 },
        canonicalizationVersion: 'v1',
        contentHashAlgorithm: 'SHA-256',
        contentHash: `hash-reuse-${other.id}`,
        dataOrigin: 'ENODE_SANDBOX',
      })
      .returning();
    if (otherRecord === undefined) {
      throw new Error('expected other record');
    }

    const [requirementB] = await db
      .insert(paymentRequirements)
      .values({
        principalId: other.id,
        walletId: wallet.id,
        deviceId: device.id,
        telemetryRecordId: otherRecord.id,
        pricingVersion: 'test',
        network: 'arc-testnet',
        chainId: 5042002n,
        asset: 'USDC',
        tokenContractAddress: '0x3600000000000000000000000000000000000000',
        amountAtomic: '400',
        amountDisplay: '0.0004',
        decimals: 6,
        sellerWalletAddress: '0x1111111111111111111111111111111111111111',
        payerWalletAddress: wallet.address,
        status: 'pending',
        expiresAt,
      })
      .returning();
    if (requirementB === undefined) {
      throw new Error('expected requirement B');
    }

    await expect(
      creditAndDeliver({
        db,
        principalId: other.id,
        walletId: wallet.id,
        deviceId: device.id,
        telemetryRecordId: otherRecord.id,
        paymentRequirementId: requirementB.id,
        chainId: 5042002n,
        amountAtomic: '400',
        asset: 'USDC',
        transactionHash: sharedHash,
        payerAddress: wallet.address,
        tokenContractAddress: '0x3600000000000000000000000000000000000000',
      }),
    ).rejects.toBeInstanceOf(PaymentTransactionReuseError);
  });
});
