import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { schemaMeta } from '@/server/infrastructure/db/schema';

const testUrl = process.env.TEST_DATABASE_URL;
if (testUrl === undefined || testUrl.length === 0) {
  throw new Error(
    'TEST_DATABASE_URL is required to run integration tests (see .env.example).',
  );
}
// Point the app's own env resolution at the test database for the duration
// of this process, so application code under test never touches dev data.
process.env.DATABASE_URL = testUrl;

// A fixed, offline configuration, so these tests pass the same on any
// machine or CI as on a developer's live-Arc .env.local. Chain access in
// tests always goes through injected fakes; no signing key is ever loaded,
// so nothing here can broadcast a transaction.
const TEST_ENV: Record<string, string> = {
  APP_ENV: 'test',
  USE_ARC_NETWORK: 'true',
  ARC_CHAIN_ID: '5042002',
  NEXT_PUBLIC_ARC_CHAIN_ID: '5042002',
  DEVICE_NFT_CONTRACT_ADDRESS: '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908',
  ARC_TRUSTED_WRITER_ADDRESSES: '0x0e12c056a563c7ebc652e288e09c9be524044cea',
  ARC_REQUIRED_CONFIRMATIONS: '3',
  VERIFICATION_MAX_ANCHOR_DELAY_HOURS: '48',
  CIRCLE_WALLET_BLOCKCHAIN: 'ARC-TESTNET',
  ADMIN_PASSWORD: 'integration-test-admin-password',
  TRUSTED_PROXY_HOPS: '1',
};
for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}
for (const key of [
  'ARC_RPC_URL',
  'ARC_AUTH_TOKEN',
  'VERIFIER_RPC_URL',
  'VERIFIER_AUTH_TOKEN',
  'ARC_EXPLORER_API_URL',
  'DEVICE_NFT_MINTER_PRIVATE_KEY',
  'PRIVATE_KEY',
]) {
  delete process.env[key];
}
process.env.API_KEY_HASH_SECRET ??= 'integration-test-secret-0123456789';

const sql = postgres(testUrl, { max: 1 });
const db = drizzle(sql);

// Clear rows left behind by a previous run BEFORE migrating: a later
// migration can add a constraint that old leftover data violates (this
// happened once already — stale 'vehicle' rows blocked adding
// devices_device_type_check). Tables may not exist yet on a brand-new test
// database; that's fine, just skip.
try {
  await sql.unsafe(
    `TRUNCATE TABLE ${schemaMeta.tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('does not exist')) {
    throw error;
  }
}

await migrate(db, { migrationsFolder: './drizzle/migrations' });
await sql.end();
