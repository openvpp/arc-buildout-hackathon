import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@/server/infrastructure/db/schema';
import { principals, wallets } from '@/server/infrastructure/db/schema';

export function createTestDb() {
  const url = process.env.DATABASE_URL;
  if (url === undefined) {
    throw new Error('DATABASE_URL not set (integration setup should set it)');
  }
  const sql = postgres(url, { max: 5 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export async function insertTestWallet(
  db: ReturnType<typeof createTestDb>['db'],
  input: { address: string; circleWalletId: string },
) {
  const [principal] = await db
    .insert(principals)
    .values({
      type: 'dashboard_user',
      displayName: `circle:${input.address}@test.local`,
    })
    .returning();
  const [wallet] = await db
    .insert(wallets)
    .values({
      chainId: 5042002n,
      address: input.address,
      normalizedAddress: input.address.toLowerCase(),
      walletType: 'circle',
      circleWalletId: input.circleWalletId,
    })
    .returning();
  if (principal === undefined || wallet === undefined) {
    throw new Error('Failed to seed test wallet');
  }
  return { principal, wallet };
}
