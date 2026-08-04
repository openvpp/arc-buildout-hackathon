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
 * Find-or-create dashboard_user principal for a verified Web3Auth subject and
 * bind the wallet as owner via principal_wallets.
 */
export async function bindDashboardOwnerWallet(
  db: Database,
  identity: VerifiedWeb3AuthIdentity,
): Promise<BoundOnboardingIdentity> {
  const wallet = await ensureWalletForAddress(db, identity.walletAddress);
  const displayName = `web3auth:${identity.subject}`;

  const [existing] = await db
    .select()
    .from(principals)
    .where(
      and(
        eq(principals.type, 'dashboard_user'),
        eq(principals.displayName, displayName),
      ),
    )
    .limit(1);

  let principalId = existing?.id;
  if (principalId === undefined) {
    const [created] = await db
      .insert(principals)
      .values({
        type: 'dashboard_user',
        displayName,
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
