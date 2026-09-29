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
