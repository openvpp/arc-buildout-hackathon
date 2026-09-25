import { and, eq } from 'drizzle-orm';

import { ensureCircleWalletForPrincipal } from '@/server/application/onboarding/ensure-circle-wallet';
import type { VerifiedGoogleIdentity } from '@/server/infrastructure/auth/google-identity';
import type { Database } from '@/server/infrastructure/db/client';
import {
  principalWallets,
  principals,
} from '@/server/infrastructure/db/schema';

export type BoundIdentity = {
  readonly principalId: string;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly normalizedAddress: string;
  readonly subject: string;
};

export function dashboardPrincipalDisplayName(email: string): string {
  return `circle:${email.trim().toLowerCase()}`;
}

/**
 * Find-or-create the dashboard_user principal for a verified Google identity,
 * ensure their Circle wallet exists, and bind the wallet as owner.
 */
export async function bindDashboardOwner(
  db: Database,
  identity: VerifiedGoogleIdentity,
): Promise<BoundIdentity> {
  const wallet = await ensureCircleWalletForPrincipal(db, {
    email: identity.email,
  });
  const displayName = dashboardPrincipalDisplayName(identity.email);

  const [existingPrincipal] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(
      and(
        eq(principals.type, 'dashboard_user'),
        eq(principals.displayName, displayName),
      ),
    )
    .limit(1);

  let principalId = existingPrincipal?.id;
  if (principalId === undefined) {
    const [created] = await db
      .insert(principals)
      .values({ type: 'dashboard_user', displayName, status: 'active' })
      .onConflictDoNothing({
        target: [principals.type, principals.displayName],
      })
      .returning({ id: principals.id });
    principalId = created?.id;
    if (principalId === undefined) {
      const [raced] = await db
        .select({ id: principals.id })
        .from(principals)
        .where(
          and(
            eq(principals.type, 'dashboard_user'),
            eq(principals.displayName, displayName),
          ),
        )
        .limit(1);
      if (raced === undefined) {
        throw new Error('Failed to create dashboard_user principal.');
      }
      principalId = raced.id;
    }
  }

  await db
    .insert(principalWallets)
    .values({ principalId, walletId: wallet.walletId, role: 'owner' })
    .onConflictDoUpdate({
      target: [principalWallets.principalId, principalWallets.walletId],
      set: { role: 'owner' },
    });

  return {
    principalId,
    walletId: wallet.walletId,
    walletAddress: wallet.address,
    normalizedAddress: wallet.normalizedAddress,
    subject: identity.subject,
  };
}
