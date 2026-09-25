import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

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
await migrate(db, { migrationsFolder: './drizzle/migrations' });
await sql.end();
