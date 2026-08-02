/**
 * Seed explicitly marked demo data for local development.
 * Never presents simulated data as production Enode / Arc data.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  hashApiKey,
  generateApiKeyMaterial,
} from '../src/server/infrastructure/auth/api-keys';
import { normalizeEvmAddress } from '../src/server/infrastructure/db/repositories/wallet-repository';
import {
  apiCredentials,
  devices,
  principalWallets,
  principals,
  wallets,
} from '../src/server/infrastructure/db/schema/index';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const hashSecret = process.env.API_KEY_HASH_SECRET;

  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }
  if (hashSecret === undefined || hashSecret.length < 32) {
    throw new Error('API_KEY_HASH_SECRET (>=32 chars) is required');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  const [agent] = await db
    .insert(principals)
    .values({
      type: 'autonomous_agent',
      displayName: 'Demo Agent (seed)',
    })
    .returning();

  if (agent === undefined) {
    throw new Error('Failed to create demo principal');
  }

  const keyMaterial = generateApiKeyMaterial();
  await db.insert(apiCredentials).values({
    principalId: agent.id,
    keyPrefix: keyMaterial.keyPrefix,
    keyHash: hashApiKey(keyMaterial.secret, hashSecret),
    scopes: [
      'telemetry:request',
      'payment:submit',
      'wallets:read',
      'devices:read',
      'telemetry:read',
    ],
  });

  const demoAddress = '0x1111111111111111111111111111111111111111';
  const [wallet] = await db
    .insert(wallets)
    .values({
      chainId: 5042002n,
      address: demoAddress,
      normalizedAddress: normalizeEvmAddress(demoAddress),
      label: 'Demo wallet (seed)',
    })
    .returning();

  if (wallet === undefined) {
    throw new Error('Failed to create demo wallet');
  }

  await db.insert(principalWallets).values({
    principalId: agent.id,
    walletId: wallet.id,
    role: 'agent',
  });

  await db.insert(devices).values({
    walletId: wallet.id,
    externalDeviceId: 'demo-enode-vehicle-1',
    deviceType: 'vehicle',
    vendor: 'DemoVendor',
    model: 'DemoEV',
    displayName: 'Demo Device (seed)',
  });

  await sql.end({ timeout: 5 });

  console.log('Demo seed complete (explicitly marked demo data).');
  console.log(`Demo principal id: ${agent.id}`);
  console.log(`Demo API key (shown once): ${keyMaterial.secret}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
