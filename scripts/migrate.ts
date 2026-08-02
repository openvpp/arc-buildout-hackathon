/**
 * Apply committed Drizzle SQL migrations.
 * Production deployments must run this as an explicit step — never during
 * ordinary application startup.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log('Applying migrations...');
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  await sql.end({ timeout: 5 });
  console.log('Migrations applied successfully.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
