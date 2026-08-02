import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type { Database } from './client';
import type * as schema from './schema';

export type TransactionClient = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export type DbOrTx = Database | TransactionClient;

/**
 * Run work inside a PostgreSQL transaction. Prefer this helper over calling
 * `db.transaction` from application/use-case code so transaction boundaries stay
 * explicit and testable.
 */
export async function withTransaction<T>(
  db: Database,
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => work(tx));
}
