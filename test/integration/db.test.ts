import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import { createOutboxRepository } from '@/server/infrastructure/db/repositories/outbox-repository';
import { createPrincipalRepository } from '@/server/infrastructure/db/repositories/principal-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import { wallets } from '@/server/infrastructure/db/schema';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('postgresql integration', () => {
  const sql = postgres(databaseUrl, { max: 5 });
  const db = drizzle(sql, { schema });

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

  it('enforces unique wallet chain + normalized address', async () => {
    const repo = createWalletRepository(db);
    const address = '0x2222222222222222222222222222222222222222';

    await repo.create({
      chainId: 5042002n,
      address,
      normalizedAddress: normalizeEvmAddress(address),
    });

    await expect(
      repo.create({
        chainId: 5042002n,
        address: address.toUpperCase(),
        normalizedAddress: normalizeEvmAddress(address),
      }),
    ).rejects.toThrow();
  });

  it('creates principals, wallets, and devices with FK integrity', async () => {
    const principals = createPrincipalRepository(db);
    const walletRepo = createWalletRepository(db);
    const deviceRepo = createDeviceRepository(db);

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Integration Agent',
    });

    const wallet = await walletRepo.create({
      chainId: 5042002n,
      address: '0x3333333333333333333333333333333333333333',
      normalizedAddress: normalizeEvmAddress(
        '0x3333333333333333333333333333333333333333',
      ),
    });

    const device = await deviceRepo.create({
      walletId: wallet.id,
      externalDeviceId: `device-${principal.id}`,
      displayName: 'Test EV',
    });

    expect(device.walletId).toBe(wallet.id);
    const loaded = await deviceRepo.findById(device.id);
    expect(loaded?.displayName).toBe('Test EV');
  });

  it('claims outbox events with skip locked semantics', async () => {
    const outbox = createOutboxRepository(db);

    await outbox.enqueue({
      aggregateType: 'webhook_delivery',
      aggregateId: 'delivery-1',
      eventType: 'PROCESS_ENODE_WEBHOOK',
      payload: { demo: true },
    });

    const claimedA = await outbox.claimNext({
      workerId: 'worker-a',
      limit: 10,
      lockDurationMs: 60_000,
    });

    expect(claimedA.length).toBeGreaterThanOrEqual(1);
    const first = claimedA[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      throw new Error('expected claimed event');
    }

    expect(first.status).toBe('processing');
    expect(first.lockedBy).toBe('worker-a');

    const claimedB = await outbox.claimNext({
      workerId: 'worker-b',
      limit: 10,
      lockDurationMs: 60_000,
    });

    expect(claimedB.some((event) => event.id === first.id)).toBe(false);

    await outbox.markCompleted(first.id);
  });

  it('rejects inserting a wallet with invalid status via check constraint', async () => {
    await expect(
      db.insert(wallets).values({
        chainId: 1n,
        address: '0x4444444444444444444444444444444444444444',
        normalizedAddress: '0x4444444444444444444444444444444444444444',
        status: 'not-a-real-status',
      }),
    ).rejects.toThrow();
  });
});
