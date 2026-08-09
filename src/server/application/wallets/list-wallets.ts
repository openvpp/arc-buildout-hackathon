import { and, asc, eq, gt } from 'drizzle-orm';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/server/config/constants';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import { principalWallets, wallets } from '@/server/infrastructure/db/schema';

export type WalletListItem = {
  readonly id: string;
  readonly address: string;
  readonly label: string | null;
  readonly chainId: string;
  readonly status: string;
};

export type ListWalletsResult = {
  readonly items: WalletListItem[];
  readonly pageInfo: {
    readonly nextCursor: string | null;
    readonly hasNextPage: boolean;
  };
};

export async function listWalletsForPrincipal(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  cursor?: string | null;
  limit?: number;
}): Promise<ListWalletsResult> {
  const take = Math.min(
    Math.max(input.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );

  const conditions = [
    eq(principalWallets.principalId, input.principal.principalId),
  ];
  if (
    input.cursor !== undefined &&
    input.cursor !== null &&
    input.cursor.length > 0
  ) {
    conditions.push(gt(wallets.id, input.cursor));
  }

  const rows = await input.db
    .select({
      id: wallets.id,
      address: wallets.address,
      label: wallets.label,
      chainId: wallets.chainId,
      status: wallets.status,
    })
    .from(principalWallets)
    .innerJoin(wallets, eq(wallets.id, principalWallets.walletId))
    .where(and(...conditions))
    .orderBy(asc(wallets.id))
    .limit(take + 1);

  const hasNextPage = rows.length > take;
  const page = hasNextPage ? rows.slice(0, take) : rows;
  const last = page.at(-1);

  return {
    items: page.map((row) => ({
      id: row.id,
      address: row.address,
      label: row.label,
      chainId: String(row.chainId),
      status: row.status,
    })),
    pageInfo: {
      nextCursor: hasNextPage && last !== undefined ? last.id : null,
      hasNextPage,
    },
  };
}
