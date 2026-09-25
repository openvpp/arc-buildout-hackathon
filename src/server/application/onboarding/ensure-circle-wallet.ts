import { eq } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { ensureCircleWallet } from '@/server/infrastructure/circle/circle-wallet-client';
import { wallets } from '@/server/infrastructure/db/schema';

export type EnsuredWallet = {
  readonly walletId: string;
  readonly address: string;
  readonly normalizedAddress: string;
};

export function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Find-or-create the Circle developer-controlled wallet for a principal.
 * Circle-side idempotency: `refId = circle-user:<email>` always resolves to
 * the same Circle wallet on repeat login (see ensureCircleWallet). Postgres-
 * side idempotency: the wallets row is keyed by the resulting real Circle
 * wallet id, so a concurrent duplicate insert is resolved by the unique
 * index rather than creating a second row.
 */
export async function ensureCircleWalletForPrincipal(
  db: Database,
  input: { email: string },
): Promise<EnsuredWallet> {
  const env = getServerEnv();
  const refId = `circle-user:${input.email.toLowerCase()}`;

  const circleWallet = await ensureCircleWallet({ refId });
  const normalizedAddress = normalizeEvmAddress(circleWallet.address);
  const chainId = BigInt(env.ARC_CHAIN_ID);

  const [existing] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.circleWalletId, circleWallet.circleWalletId))
    .limit(1);
  if (existing !== undefined) {
    return {
      walletId: existing.id,
      address: existing.address,
      normalizedAddress: existing.normalizedAddress,
    };
  }

  const [created] = await db
    .insert(wallets)
    .values({
      chainId,
      address: circleWallet.address,
      normalizedAddress,
      walletType: 'circle',
      circleWalletId: circleWallet.circleWalletId,
      label: 'Circle developer-controlled wallet',
    })
    .onConflictDoUpdate({
      target: wallets.circleWalletId,
      set: { updatedAt: new Date() },
    })
    .returning();
  if (created === undefined) {
    throw new Error('Failed to persist Circle wallet.');
  }
  return {
    walletId: created.id,
    address: created.address,
    normalizedAddress: created.normalizedAddress,
  };
}
