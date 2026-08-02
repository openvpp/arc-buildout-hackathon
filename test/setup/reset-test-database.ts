import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';

import * as schema from '@/server/infrastructure/db/schema';

/**
 * Wipe application + Drizzle migration state, then re-apply migrations.
 *
 * Must drop the `drizzle` schema as well as `public`. Dropping only `public`
 * leaves `__drizzle_migrations` intact, so `migrate()` no-ops and tables
 * never come back (common when CI runs `pnpm db:migrate` before tests).
 */
export async function resetAndMigrateTestDatabase(
  sql: postgres.Sql,
): Promise<void> {
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await sql`create extension if not exists pgcrypto`;

  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder: './drizzle/migrations' });
}
