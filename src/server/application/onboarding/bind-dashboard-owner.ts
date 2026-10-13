import { and, eq } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import { ensureCircleWalletForPrincipal } from '@/server/application/onboarding/ensure-circle-wallet';
import type { Database } from '@/server/infrastructure/db/client';
import {
  principalWallets,
  principals,
  wallets,
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
 * Callers must already know the email belongs to the person signing in:
 * a verified Google ID token (`signInWithGoogle`) or a matching password
 * hash (`signInWithPassword` / `registerWithPassword`). This function does
 * not check that proof itself. The demo seed calls it directly because it
 * is a local script, not a login. The wallet stays developer-custodied:
 * no on-chain signing key is handed to the browser.
 */
export async function bindDashboardOwner(
  db: Database,
  input: { email: string },
): Promise<BoundIdentity> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const displayName = dashboardPrincipalDisplayName(normalizedEmail);

  const [existingPrincipal] = await db
    .select({ id: principals.id, status: principals.status })
    .from(principals)
    .where(
      and(
        eq(principals.type, 'dashboard_user'),
        eq(principals.displayName, displayName),
      ),
    )
    .limit(1);
  if (existingPrincipal?.status === 'disabled') {
    throw new ApplicationError(
      'PRINCIPAL_DISABLED',
      'This account is disabled.',
    );
  }

  const wallet = await ensureCircleWalletForPrincipal(db, {
    email: normalizedEmail,
  });
  const [walletRow] = await db
    .select({ status: wallets.status })
    .from(wallets)
    .where(eq(wallets.id, wallet.walletId))
    .limit(1);
  if (walletRow?.status === 'disabled') {
    throw new ApplicationError('WALLET_DISABLED', 'This wallet is disabled.');
  }

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
        .select({ id: principals.id, status: principals.status })
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
      if (raced.status === 'disabled') {
        throw new ApplicationError(
          'PRINCIPAL_DISABLED',
          'This account is disabled.',
        );
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
