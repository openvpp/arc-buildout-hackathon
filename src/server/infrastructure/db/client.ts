import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getServerEnv } from '@/server/config/env';
import * as schema from '@/server/infrastructure/db/schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

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
