import { and, eq } from 'drizzle-orm';

import { ensureWalletForAddress } from '@/server/application/onboarding/ensure-wallet';
import type { VerifiedWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import type { Database } from '@/server/infrastructure/db/client';
import {
  principalWallets,
  principals,
} from '@/server/infrastructure/db/schema';

export type BoundOnboardingIdentity = {
  readonly principalId: string;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly normalizedAddress: string;
  readonly subject: string;
};

/**
 * Prefer verified email so the same Gmail login lands on one dashboard_user
 * even when Web3Auth mints a new embedded EVM address or changes JWT `sub`.
 */
export function dashboardPrincipalDisplayName(
  identity: Pick<VerifiedWeb3AuthIdentity, 'subject' | 'email'>,
): string {
  const email = identity.email?.trim().toLowerCase();
  if (email !== undefined && email.length > 0) {
    return `web3auth:${email}`;
  }
  return `web3auth:${identity.subject}`;
}

async function findPrincipalByDisplayName(
  db: Database,
  displayName: string,
): Promise<string | null> {
  const [existing] = await db
    .select({ id: principals.id })
    .from(principals)
    .where(
      and(
        eq(principals.type, 'dashboard_user'),
        eq(principals.displayName, displayName),
      ),
    )
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Find-or-create dashboard_user principal for a verified Web3Auth subject and
 * bind the wallet as owner via principal_wallets.
 */
export async function bindDashboardOwnerWallet(
  db: Database,
  identity: VerifiedWeb3AuthIdentity,
): Promise<BoundOnboardingIdentity> {
  const wallet = await ensureWalletForAddress(db, identity.walletAddress);
  const emailName = dashboardPrincipalDisplayName(identity);
  const subjectName = `web3auth:${identity.subject}`;

  let principalId = await findPrincipalByDisplayName(db, emailName);

  // Legacy: older rows may be keyed by JWT sub when email was not preferred.
  if (principalId === null && subjectName !== emailName) {
    const subjectPrincipalId = await findPrincipalByDisplayName(
      db,
      subjectName,
    );
    if (subjectPrincipalId !== null) {
      principalId = subjectPrincipalId;
      // Merge forward onto the email display name when unused.
      const emailTaken = await findPrincipalByDisplayName(db, emailName);
      if (emailTaken === null && emailName.startsWith('web3auth:')) {
        await db
          .update(principals)
          .set({ displayName: emailName, updatedAt: new Date() })
          .where(eq(principals.id, subjectPrincipalId));
      }
    }
  }

  if (principalId === null) {
    const [created] = await db
      .insert(principals)
      .values({
        type: 'dashboard_user',
        displayName: emailName,
        status: 'active',
      })
      .returning({ id: principals.id });
    if (created === undefined) {
      throw new Error('Failed to create dashboard_user principal');
    }
    principalId = created.id;
  }

  await db
    .insert(principalWallets)
    .values({
      principalId,
      walletId: wallet.walletId,
      role: 'owner',
    })
    .onConflictDoUpdate({
      target: [principalWallets.principalId, principalWallets.walletId],
      set: {
        role: 'owner',
      },
    });

  return {
    principalId,
    walletId: wallet.walletId,
    walletAddress: wallet.address,
    normalizedAddress: wallet.normalizedAddress,
    subject: identity.subject,
  };
}
