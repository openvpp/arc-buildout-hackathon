import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { getServerEnv } from '@/server/config/env';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;
export type SqlClient = Sql;

type GlobalDbState = {
  sqlClient: SqlClient | undefined;
  db: Database | undefined;
};

const globalForDb = globalThis as typeof globalThis & {
  __evTelemetryDb?: GlobalDbState;
};

function getGlobalState(): GlobalDbState {
  const existing = globalForDb.__evTelemetryDb;
  if (existing === undefined) {
    const created: GlobalDbState = {
      sqlClient: undefined,
      db: undefined,
    };
    globalForDb.__evTelemetryDb = created;
    return created;
  }
  return existing;
}

export function createSqlClient(connectionString?: string): SqlClient {
  const env = getServerEnv();
  const url = connectionString ?? env.DATABASE_URL;

  return postgres(url, {
    max: env.DATABASE_POOL_MAX,
    connect_timeout: Math.ceil(env.DATABASE_CONNECTION_TIMEOUT_MS / 1000),
    idle_timeout: Math.ceil(env.DATABASE_IDLE_TIMEOUT_MS / 1000),
    prepare: true,
    connection: {
      application_name: 'ev-telemetry-backend',
      statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    },
    ssl: env.DATABASE_SSL_MODE === 'disable' ? false : 'require',
  });
}

export function createDrizzleClient(sqlClient: SqlClient): Database {
  return drizzle(sqlClient, { schema });
}

/**
 * Shared application database handle.
 *
 * Reuses a single pool across Next.js hot reloads in development. Do not create
 * a new pool per request.
 */
export function getDb(): Database {
  const state = getGlobalState();
  if (state.db === undefined || state.sqlClient === undefined) {
    state.sqlClient = createSqlClient();
    state.db = createDrizzleClient(state.sqlClient);
  }
  return state.db;
}

export function getSqlClient(): SqlClient {
  const state = getGlobalState();
  if (state.sqlClient === undefined) {
    state.sqlClient = createSqlClient();
    state.db = createDrizzleClient(state.sqlClient);
  }
  return state.sqlClient;
}

/** Close the shared pool (worker shutdown / tests). */
export async function closeDb(): Promise<void> {
  const state = getGlobalState();
  if (state.sqlClient !== undefined) {
    await state.sqlClient.end({ timeout: 5 });
  }
  state.sqlClient = undefined;
  state.db = undefined;
}

/** Check PostgreSQL connectivity with a strict timeout. */
export async function checkDatabaseConnectivity(
  timeoutMs = 2000,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sqlClient = getSqlClient();
  try {
    const result = await Promise.race([
      sqlClient`select 1 as ok`,
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`database ping timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);

    if (!Array.isArray(result) || result.length === 0) {
      return { ok: false, error: 'empty ping response' };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, error: message };
  }
}
