import { and, eq } from 'drizzle-orm';

import type { DashboardSessionClaims } from '@/server/infrastructure/auth/dashboard-session';
import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import {
  principalWallets,
  principals,
  wallets,
} from '@/server/infrastructure/db/schema';

/**
 * The signed session is not enough on its own: a disabled principal, a
 * disabled wallet, or a cookie whose wallet binding was removed must fail
 * closed on the next request instead of waiting out the JWT TTL.
 */
export async function isDashboardSessionActive(
  db: DatabaseExecutor,
  claims: DashboardSessionClaims,
): Promise<boolean> {
  const [row] = await db
    .select({ principalId: principals.id })
    .from(principals)
    .innerJoin(
      principalWallets,
      and(
        eq(principalWallets.principalId, principals.id),
        eq(principalWallets.walletId, claims.walletId),
        eq(principalWallets.role, 'owner'),
      ),
    )
    .innerJoin(
      wallets,
      and(
        eq(wallets.id, principalWallets.walletId),
        eq(wallets.status, 'active'),
      ),
    )
    .where(
      and(
        eq(principals.id, claims.principalId),
        eq(principals.status, 'active'),
      ),
    )
    .limit(1);
  return row !== undefined;
}
