import { and, eq } from 'drizzle-orm';

import { ensureCircleWalletForPrincipal } from '@/server/application/onboarding/ensure-circle-wallet';
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
 * Find-or-create the dashboard_user principal for an email, ensure their
 * Circle developer-controlled wallet exists, and bind it as owner.
 *
 * Identity here is self-asserted (the email the caller typed), not verified
 * against an external identity provider — this mirrors openvpp-app's actual
 * Circle DCW flow (its Google path fetched a profile client-side rather than
 * verifying an id_token server-side, and its email path never checked the
 * password field at all). That's an intentional product decision for this
 * milestone, not an oversight: the wallet is developer-custodied regardless
 * of who claims the email, so there's no on-chain signing authority being
 * handed out here. Don't read this as a pattern for anything that does hand
 * out signing authority.
 */
export async function bindDashboardOwner(
  db: Database,
  input: { email: string },
): Promise<BoundIdentity> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const wallet = await ensureCircleWalletForPrincipal(db, {
    email: normalizedEmail,
  });
  const displayName = dashboardPrincipalDisplayName(normalizedEmail);

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
    subject: normalizedEmail,
  };
}
