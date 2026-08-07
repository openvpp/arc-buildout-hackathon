/**
 * Async DeviceNFT mint: claim-before-mint idempotency + concurrency safety.
 * Requires PostgreSQL (docker compose service `postgres_test` on :5433).
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import { parseServerEnv, resetServerEnvCache } from '@/server/config/env';
import { createDeviceRepository } from '@/server/infrastructure/db/repositories/device-repository';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '@/server/infrastructure/db/schema';
import { devices } from '@/server/infrastructure/db/schema';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

async function seedDevice(
  db: ReturnType<typeof drizzle<typeof schema>>,
  suffix: string,
) {
  const wallets = createWalletRepository(db);
  const deviceRepo = createDeviceRepository(db);
  const address = `0x${suffix.padStart(40, '0')}`;
  const wallet = await wallets.create({
    chainId: 5042002n,
    address,
    normalizedAddress: normalizeEvmAddress(address),
  });
  const device = await deviceRepo.create({
    walletId: wallet.id,
    externalDeviceId: `veh-${suffix}`,
    displayName: `EV ${suffix}`,
  });
  return { device, address };
}

describe('mintDeviceNftIfNeeded integration', () => {
  const sql = postgres(databaseUrl, { max: 8 });
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

  it('mints once and records the token + status', async () => {
    const { device } = await seedDevice(db, '1');
    const result = await mintDeviceNftIfNeeded({ db, deviceId: device.id });

    expect(result.status).toBe('minted');
    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, device.id))
      .limit(1);
    expect(row?.mintStatus).toBe('minted');
    expect(row?.nftTokenId).toBeTruthy();
    expect(row?.nftTransactionHash).toBeTruthy();
  });

  it('is idempotent — a second call does not re-mint', async () => {
    const { device } = await seedDevice(db, '2');
    const first = await mintDeviceNftIfNeeded({ db, deviceId: device.id });
    expect(first.status).toBe('minted');

    const second = await mintDeviceNftIfNeeded({ db, deviceId: device.id });
    expect(second.status).toBe('already_minted');
    const firstTokenId = first.status === 'minted' ? first.tokenId : null;
    const secondTokenId =
      second.status === 'already_minted' ? second.tokenId : null;
    expect(secondTokenId).toBe(firstTokenId);
  });

  it('mints exactly once under concurrent callers (claim-before-mint)', async () => {
    const { device } = await seedDevice(db, '3');
    const results = await Promise.all([
      mintDeviceNftIfNeeded({ db, deviceId: device.id }),
      mintDeviceNftIfNeeded({ db, deviceId: device.id }),
      mintDeviceNftIfNeeded({ db, deviceId: device.id }),
    ]);

    const minted = results.filter((r) => r.status === 'minted');
    // The winner mints; losers report already_minted or busy — never a 2nd mint.
    expect(minted.length).toBe(1);
    expect(
      results.every(
        (r) =>
          r.status === 'minted' ||
          r.status === 'already_minted' ||
          r.status === 'busy',
      ),
    ).toBe(true);

    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, device.id))
      .limit(1);
    expect(row?.mintStatus).toBe('minted');
    expect(row?.nftTokenId).toBeTruthy();
  });
});
