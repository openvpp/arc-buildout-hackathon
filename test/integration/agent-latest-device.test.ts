/**
 * Newest onboarded device discovery for the agent API.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getLatestAgentDevice } from '@/server/application/agent/get-latest-agent-device';
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
  enodeConnections,
  principalWallets,
} from '@/server/infrastructure/db/schema';
import type { ApiError } from '@/server/transport/http/api-error';

import { resetAndMigrateTestDatabase } from '../setup/reset-test-database';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test';

const hashSecret = 'test-api-key-hash-secret-32chars!!';

function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('getLatestAgentDevice integration', () => {
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

  it('returns the newest Enode-linked device for the wallet', async () => {
    const principals = createPrincipalRepository(db);
    const wallets = createWalletRepository(db);
    const devices = createDeviceRepository(db);

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Discovery Agent',
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

    const older = await devices.create({
      walletId: wallet.id,
      externalDeviceId: `older-${principal.id}`,
      displayName: 'Older EV',
    });

    const [connection] = await db
      .insert(enodeConnections)
      .values({
        externalUserId: `enode-user-${principal.id}`,
        walletId: wallet.id,
        status: 'connected',
        connectedAt: new Date(),
      })
      .returning();

    if (connection === undefined) {
      throw new Error('expected enode connection row');
    }

    const newer = await devices.create({
      walletId: wallet.id,
      externalDeviceId: `newer-enode-${principal.id}`,
      displayName: 'Newer Enode EV',
      enodeConnectionId: connection.id,
    });

    const authPrincipal: AuthenticatedPrincipal = {
      principalId: principal.id,
      principalType: 'autonomous_agent',
      credentialId: 'cred-discovery',
      scopes: ['telemetry:request'],
      keyPrefix: 'evt_test',
    };

    const latest = await getLatestAgentDevice({
      db,
      principal: authPrincipal,
      walletAddress: address,
    });

    expect(latest.deviceId).toBe(newer.id);
    expect(latest.externalDeviceId).toBe(newer.externalDeviceId);
    expect(latest.deviceId).not.toBe(older.id);
  });

  it('404s when the principal has no devices', async () => {
    const principals = createPrincipalRepository(db);
    const wallets = createWalletRepository(db);

    const principal = await principals.create({
      type: 'autonomous_agent',
      displayName: 'Empty Agent',
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

    await expect(
      getLatestAgentDevice({
        db,
        principal: {
          principalId: principal.id,
          principalType: 'autonomous_agent',
          credentialId: 'cred-empty',
          scopes: ['telemetry:request'],
          keyPrefix: 'evt_empty',
        },
        walletAddress: address,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    } satisfies Partial<ApiError>);
  });
});
