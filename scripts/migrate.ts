/**
 * Apply committed Drizzle SQL migrations.
 * Production deployments must run this as an explicit step — never during
 * ordinary application startup.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function assertSchemaOrClearStaleJournal(
  sql: postgres.Sql,
): Promise<void> {
  const walletsRows = await sql<{ walletsExist: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'wallets'
    ) as "walletsExist"
  `;
  if (walletsRows[0]?.walletsExist === true) {
    return;
  }

  const journalRows = await sql<{ journalExists: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
    ) as "journalExists"
  `;
  if (journalRows[0]?.journalExists !== true) {
    return;
  }

  const appliedRows = await sql<{ applied: number }[]>`
    select count(*)::int as applied from drizzle.__drizzle_migrations
  `;
  const applied = appliedRows[0]?.applied ?? 0;
  if (applied === 0) {
    return;
  }

  console.warn(
    `public.wallets is missing but drizzle.__drizzle_migrations has ${applied} row(s). ` +
      'Clearing stale journal so migrations can recreate the schema.',
  );
  await sql`truncate table drizzle.__drizzle_migrations`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  console.log('Applying migrations...');
  await assertSchemaOrClearStaleJournal(sql);
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
  await sql.end({ timeout: 5 });
  console.log('Migrations applied successfully.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
