import { eq, and } from 'drizzle-orm';

import type {
  WalletRecord,
  WalletRepository,
} from '@/server/domain/shared/ports';

import { principalWallets, wallets } from '../schema';
import type { DbOrTx } from '../transaction';

function mapWallet(row: typeof wallets.$inferSelect): WalletRecord {
  return {
    id: row.id,
    chainId: row.chainId,
    address: row.address,
    normalizedAddress: row.normalizedAddress,
    walletType: row.walletType,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function normalizeEvmAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function createWalletRepository(db: DbOrTx): WalletRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(wallets)
        .values({
          chainId: input.chainId,
          address: input.address,
          normalizedAddress: input.normalizedAddress,
          ...(input.label !== undefined ? { label: input.label } : {}),
        })
        .returning();

      if (row === undefined) {
        throw new Error('Failed to insert wallet');
      }

      return mapWallet(row);
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(wallets)
        .where(eq(wallets.id, id))
        .limit(1);

      return row === undefined ? null : mapWallet(row);
    },

    async findByChainAndNormalizedAddress(chainId, normalizedAddress) {
      const [row] = await db
        .select()
        .from(wallets)
        .where(
          and(
            eq(wallets.chainId, chainId),
            eq(wallets.normalizedAddress, normalizedAddress),
          ),
        )
        .limit(1);

      return row === undefined ? null : mapWallet(row);
    },

    async listByPrincipal(principalId) {
      const rows = await db
        .select({ wallet: wallets })
        .from(principalWallets)
        .innerJoin(wallets, eq(wallets.id, principalWallets.walletId))
        .where(eq(principalWallets.principalId, principalId));

      return rows.map((row) => mapWallet(row.wallet));
    },
  };
}
