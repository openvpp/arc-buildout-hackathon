import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getServerEnv } from '@/server/config/env';
import * as schema from '@/server/infrastructure/db/schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export type DatabaseTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** A request transaction or the process-wide pool. */
export type DatabaseExecutor = Database | DatabaseTransaction;

let cachedDb: Database | null = null;
let cachedSql: postgres.Sql | null = null;

/** Process-wide Postgres pool + Drizzle instance. Server-only. */
export function getDb(): Database {
  if (cachedDb !== null) {
    return cachedDb;
  }
  const env = getServerEnv();
  cachedSql = postgres(env.DATABASE_URL, {
    ssl: env.DATABASE_SSL_MODE === 'require' ? 'require' : false,
    max: 10,
  });
  cachedDb = drizzle(cachedSql, { schema });
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  if (cachedSql !== null) {
    await cachedSql.end({ timeout: 5 });
    cachedSql = null;
    cachedDb = null;
  }
}
