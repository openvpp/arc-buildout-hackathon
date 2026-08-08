import { ARC_TESTNET_CHAIN_ID } from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import {
  createWalletRepository,
  normalizeEvmAddress,
} from '@/server/infrastructure/db/repositories/wallet-repository';

/**
 * Find-or-create an Arc-chain wallet row by EVM address (Web3Auth / agent).
 */
export async function ensureWalletForAddress(
  db: Database,
  walletAddress: string,
): Promise<{
  walletId: string;
  address: string;
  normalizedAddress: string;
}> {
  const env = getServerEnv();
  const chainId = BigInt(env.ARC_CHAIN_ID ?? ARC_TESTNET_CHAIN_ID);
  const normalized = normalizeEvmAddress(walletAddress);
  const wallets = createWalletRepository(db);
  const existing = await wallets.findByChainAndNormalizedAddress(
    chainId,
    normalized,
  );
  if (existing !== null) {
    return {
      walletId: existing.id,
      address: existing.address,
      normalizedAddress: existing.normalizedAddress,
    };
  }
  const created = await wallets.create({
    chainId,
    address: walletAddress.trim(),
    normalizedAddress: normalized,
    label: 'Web3Auth onboarded wallet',
  });
  return {
    walletId: created.id,
    address: created.address,
    normalizedAddress: created.normalizedAddress,
  };
}
