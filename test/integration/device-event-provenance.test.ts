/**
 * DeviceNFT recordDeviceEvent mock path + strict delivery gate.
 * Requires Postgres (pnpm services:up).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkTelemetryAnchorConfirmations } from '@/server/application/provenance/check-anchor-confirmations';
import { submitTelemetryAnchor } from '@/server/application/provenance/submit-telemetry-anchor';
import { requestLatestTelemetry } from '@/server/application/telemetry/request-latest-telemetry';
import { resetServerEnvCache } from '@/server/config/env';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import { createMockProvenanceAnchor } from '@/server/infrastructure/blockchain/provenance-anchor';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createOutboxRepository } from '@/server/infrastructure/db/repositories/outbox-repository';
import { createPrincipalRepository } from '@/server/infrastructure/db/repositories/principal-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import {
  outboxEvents,
  principalWallets,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { createMockCircleGatewaySeller } from '@/server/infrastructure/payments/circle-gateway-seller';
import { createConfiguredPricingPolicy } from '@/server/infrastructure/payments/pricing-policy';
import type { ApiError } from '@/server/transport/http/api-error';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('device event provenance', () => {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });

  beforeAll(async () => {
    resetServerEnvCache();
    setEnv('DATABASE_URL', databaseUrl);
    setEnv('API_KEY_HASH_SECRET', hashSecret);
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('PROVENANCE_DELIVERY_MODE', 'pending');
    setEnv('TELEMETRY_PRICE_USDC_ATOMIC', '400');
    resetServerEnvCache();
    await resetAndMigrateTestDatabase(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it('mock submit + confirm moves a record to ANCHORED', async () => {
    const principals = createPrincipalRepository(db);
    const wallets = createWalletRepository(db);
    const devices = createDeviceRepository(db);
    const outbox = createOutboxRepository(db);
    const provenanceAnchor = createMockProvenanceAnchor();

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Anchor Integration Agent',
    });
    const address = '0x5555555555555555555555555555555555555555';
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
      externalDeviceId: `anchor-device-${principal.id}`,
      displayName: 'Anchor Test EV',
    });
    await db
      .update(schema.devices)
      .set({ nftTokenId: '101', mintStatus: 'minted' })
      .where(eq(schema.devices.id, device.id));

    const recordedAt = new Date('2026-06-02T12:00:00.000Z');
    const contentHash =
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
    const [record] = await db
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
        contentHash,
        dataOrigin: 'ENODE_SANDBOX',
        anchorStatus: 'unanchored',
      })
      .returning();

    expect(record).toBeDefined();
    if (record === undefined) {
      throw new Error('expected telemetry record');
    }

    await submitTelemetryAnchor({
      db,
      outbox,
      provenanceAnchor,
      telemetryRecordId: record.id,
      contentHash,
    });

    const [submitted] = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.id, record.id));
    expect(submitted?.anchorStatus).toBe('submitted');
    expect(submitted?.anchorTransactionHash).toMatch(/^0x[a-f0-9]{64}$/);

    const confirmJobs = await db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.eventType, 'CHECK_ANCHOR_CONFIRMATIONS'));
    expect(confirmJobs.some((job) => job.aggregateId === record.id)).toBe(true);

    await checkTelemetryAnchorConfirmations({
      db,
      provenanceAnchor,
      telemetryRecordId: record.id,
      ...(submitted?.anchorTransactionHash !== undefined &&
      submitted.anchorTransactionHash !== null
        ? { transactionHash: submitted.anchorTransactionHash }
        : {}),
    });

    const [anchored] = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.id, record.id));
    expect(anchored?.anchorStatus).toBe('anchored');
    expect(anchored?.anchoredAt).toBeInstanceOf(Date);
  });

  it('does not mark failed when DeviceNFT is not minted yet', async () => {
    const principals = createPrincipalRepository(db);
    const wallets = createWalletRepository(db);
    const devices = createDeviceRepository(db);
    const outbox = createOutboxRepository(db);
    const provenanceAnchor = createMockProvenanceAnchor();

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Await NFT Agent',
    });
    const address = '0x7777777777777777777777777777777777777777';
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
      externalDeviceId: `await-nft-${principal.id}`,
      displayName: 'Unminted EV',
    });

    const recordedAt = new Date('2026-06-04T12:00:00.000Z');
    const contentHash =
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const [record] = await db
      .insert(telemetryRecords)
      .values({
        deviceId: device.id,
        source: 'enode',
        receivedAt: recordedAt,
        recordedAt,
        schemaVersion: '1.0.0',
        telemetryPayload: { stateOfChargePercent: 11 },
        canonicalPayload: { v: 1 },
        canonicalizationVersion: 'v1',
        contentHashAlgorithm: 'SHA-256',
        contentHash,
        dataOrigin: 'ENODE_SANDBOX',
        anchorStatus: 'unanchored',
      })
      .returning();
    expect(record).toBeDefined();
    if (record === undefined) {
      throw new Error('expected telemetry record');
    }

    await expect(
      submitTelemetryAnchor({
        db,
        outbox,
        provenanceAnchor,
        telemetryRecordId: record.id,
        contentHash,
      }),
    ).rejects.toThrow(/DeviceNFT token not minted/);

    const [unchanged] = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.id, record.id));
    expect(unchanged?.anchorStatus).toBe('unanchored');
    expect(unchanged?.anchorTransactionHash).toBeNull();
  });

  it('strict mode blocks sale until record is anchored', async () => {
    setEnv('PROVENANCE_DELIVERY_MODE', 'strict');
    resetServerEnvCache();

    try {
      const principals = createPrincipalRepository(db);
      const wallets = createWalletRepository(db);
      const devices = createDeviceRepository(db);
      const pricing = createConfiguredPricingPolicy();
      const circleSeller = createMockCircleGatewaySeller();

      const principal = await principals.create({
        type: 'autonomous_agent',
        displayName: 'Strict Mode Agent',
      });
      const address = '0x6666666666666666666666666666666666666666';
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
        externalDeviceId: `strict-device-${principal.id}`,
        displayName: 'Strict Test EV',
      });

      const recordedAt = new Date('2026-06-03T12:00:00.000Z');
      await db.insert(telemetryRecords).values({
        deviceId: device.id,
        source: 'enode',
        receivedAt: recordedAt,
        recordedAt,
        schemaVersion: '1.0.0',
        telemetryPayload: { stateOfChargePercent: 10 },
        canonicalPayload: { v: 1 },
        canonicalizationVersion: 'v1',
        contentHashAlgorithm: 'SHA-256',
        contentHash: `strict-hash-${principal.id}`,
        dataOrigin: 'ENODE_SANDBOX',
        anchorStatus: 'unanchored',
      });

      const auth: AuthenticatedPrincipal = {
        principalId: principal.id,
        principalType: 'autonomous_agent',
        credentialId: '00000000-0000-0000-0000-000000000066',
        scopes: ['telemetry:request', 'payment:submit'],
        keyPrefix: 'test',
      };

      await expect(
        requestLatestTelemetry({
          db,
          principal: auth,
          pricing,
          circleSeller,
          walletAddress: address,
          deviceId: device.id,
          paymentSignatureHeader: null,
          resourceUrl: 'http://localhost:3000/api/v1/agent/telemetry/latest',
        }),
      ).rejects.toMatchObject({
        code: 'PROVENANCE_PENDING',
        status: 409,
      } satisfies Partial<ApiError>);
    } finally {
      setEnv('PROVENANCE_DELIVERY_MODE', 'pending');
      resetServerEnvCache();
    }
  });
});
