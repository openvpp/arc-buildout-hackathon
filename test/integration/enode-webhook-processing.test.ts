/**
 * Enode webhook delivery processing: partial-batch retry (no silent telemetry
 * loss) and empty-event skip (no all-null anchored record).
 * Requires PostgreSQL (docker compose service `postgres_test` on :5433).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { processEnodeWebhookDelivery } from '@/server/application/webhooks/enode-webhook';
import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createOutboxRepository } from '@/server/infrastructure/db/repositories/outbox-repository';
import { insertWebhookDelivery } from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import {
  telemetryRecords,
  webhookDeliveries,
} from '@/server/infrastructure/db/schema';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('processEnodeWebhookDelivery integration', () => {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });
  const outbox = createOutboxRepository(db);

  beforeAll(async () => {
    resetServerEnvCache();
    setEnv('DATABASE_URL', databaseUrl);
    setEnv('API_KEY_HASH_SECRET', hashSecret);
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    parseServerEnv({
      DATABASE_URL: databaseUrl,
      API_KEY_HASH_SECRET: hashSecret,
      APP_ENV: 'test',
      ALLOW_MOCK_ADAPTERS: 'true',
    });
    await resetAndMigrateTestDatabase(sql);
  }, 60_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function seedDevice(suffix: string, externalDeviceId: string) {
    const wallets = createWalletRepository(db);
    const deviceRepo = createDeviceRepository(db);
    const address = `0x${suffix.padStart(40, '0')}`;
    const wallet = await wallets.create({
      chainId: 5042002n,
      address,
      normalizedAddress: normalizeEvmAddress(address),
    });
    return deviceRepo.create({
      walletId: wallet.id,
      externalDeviceId,
      displayName: `EV ${suffix}`,
    });
  }

  async function insertDelivery(rawPayload: unknown, dedupeKey: string) {
    return insertWebhookDelivery(db, {
      provider: 'enode',
      providerEventId: dedupeKey,
      dedupeKey,
      eventType: 'user:vehicle:updated',
      signature: null,
      headers: {},
      rawPayload,
      payloadHash: dedupeKey,
      processingStatus: 'queued',
    });
  }

  it('retries the delivery when a referenced device is missing, but keeps the present one', async () => {
    const present = await seedDevice('a1', 'veh-present');
    const payload = [
      {
        event: 'user:vehicle:updated',
        vehicle: { id: 'veh-present', chargeState: { batteryLevel: 55 } },
      },
      {
        event: 'user:vehicle:updated',
        vehicle: { id: 'veh-not-onboarded', chargeState: { batteryLevel: 60 } },
      },
    ];
    const delivery = await insertDelivery(payload, 'batch-partial');

    await expect(
      processEnodeWebhookDelivery({
        db,
        outbox,
        webhookDeliveryId: delivery.id,
      }),
    ).rejects.toThrow(/Device not found/);

    // Present device's telemetry was still ingested (not lost).
    const records = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.deviceId, present.id));
    expect(records.length).toBe(1);
    expect(records[0]?.telemetryPayload).toMatchObject({
      stateOfChargePercent: 55,
    });

    // Delivery is marked failed for retry (not silently processed).
    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id))
      .limit(1);
    expect(row?.processingStatus).toBe('failed');
    expect(row?.lastErrorCode).toBe('DEVICE_NOT_FOUND');
  });

  it('skips an empty discovered event without creating a telemetry record', async () => {
    const device = await seedDevice('b2', 'veh-empty');
    const payload = [
      { event: 'user:vehicle:discovered', vehicle: { id: 'veh-empty' } },
    ];
    const delivery = await insertDelivery(payload, 'discovered-empty');

    await processEnodeWebhookDelivery({
      db,
      outbox,
      webhookDeliveryId: delivery.id,
    });

    const records = await db
      .select()
      .from(telemetryRecords)
      .where(eq(telemetryRecords.deviceId, device.id));
    expect(records.length).toBe(0);

    const [row] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, delivery.id))
      .limit(1);
    expect(row?.processingStatus).toBe('processed');
  });
});
