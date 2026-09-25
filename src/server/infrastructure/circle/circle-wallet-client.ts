import {
  type Blockchain,
  type CircleDeveloperControlledWalletsClient,
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

import { getServerEnv } from '@/server/config/env';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'circle-wallet-client' });

export type CircleWallet = {
  readonly circleWalletId: string;
  readonly address: string;
  readonly blockchain: string;
};

let cachedClient: CircleDeveloperControlledWalletsClient | null = null;
let cachedWalletSetId: string | null = null;

function client(): CircleDeveloperControlledWalletsClient {
  if (cachedClient !== null) {
    return cachedClient;
  }
  const env = getServerEnv();
  if (
    env.CIRCLE_API_KEY === undefined ||
    env.CIRCLE_API_KEY.length === 0 ||
    env.CIRCLE_ENTITY_SECRET === undefined ||
    env.CIRCLE_ENTITY_SECRET.length === 0
  ) {
    throw new Error('Circle API key / entity secret are not configured.');
  }
  cachedClient = initiateDeveloperControlledWalletsClient({
    apiKey: env.CIRCLE_API_KEY,
    entitySecret: env.CIRCLE_ENTITY_SECRET,
  });
  return cachedClient;
}

/** Find-or-create the single wallet set this app provisions wallets under. */
async function ensureWalletSetId(): Promise<string> {
  if (cachedWalletSetId !== null) {
    return cachedWalletSetId;
  }
  const env = getServerEnv();
  if (
    env.CIRCLE_WALLET_SET_ID !== undefined &&
    env.CIRCLE_WALLET_SET_ID.length > 0
  ) {
    cachedWalletSetId = env.CIRCLE_WALLET_SET_ID;
    return cachedWalletSetId;
  }

  const c = client();
  const existing = await c.listWalletSets({});
  const first = existing.data?.walletSets?.[0];
  if (first !== undefined) {
    cachedWalletSetId = first.id;
    return cachedWalletSetId;
  }

  const created = await c.createWalletSet({ name: 'arc-ev-fleet' });
  const walletSetId = created.data?.walletSet?.id;
  if (walletSetId === undefined || walletSetId.length === 0) {
    throw new Error('Circle createWalletSet returned no wallet set id.');
  }
  log.info('circle.wallet_set.created', { walletSetId });
  cachedWalletSetId = walletSetId;
  return cachedWalletSetId;
}

/**
 * Find-or-create a developer-controlled wallet for `refId` (this app's
 * principal identity key), tagged via Circle's `refId` wallet metadata so a
 * repeat login resolves the same wallet instead of minting a new one.
 */
export async function ensureCircleWallet(input: {
  refId: string;
}): Promise<CircleWallet> {
  const env = getServerEnv();
  const c = client();
  const walletSetId = await ensureWalletSetId();

  const existing = await c.listWallets({ walletSetId, refId: input.refId });
  const existingWallet = existing.data?.wallets?.[0];
  if (existingWallet !== undefined) {
    return {
      circleWalletId: existingWallet.id,
      address: existingWallet.address,
      blockchain: existingWallet.blockchain,
    };
  }

  const created = await c.createWallets({
    walletSetId,
    blockchains: [env.CIRCLE_WALLET_BLOCKCHAIN as Blockchain],
    count: 1,
    metadata: [{ refId: input.refId }],
  });
  const wallet = created.data?.wallets?.[0];
  if (wallet === undefined) {
    throw new Error('Circle createWallets returned no wallet.');
  }
  log.info('circle.wallet.created', {
    circleWalletId: wallet.id,
    blockchain: wallet.blockchain,
  });
  return {
    circleWalletId: wallet.id,
    address: wallet.address,
    blockchain: wallet.blockchain,
  };
}
