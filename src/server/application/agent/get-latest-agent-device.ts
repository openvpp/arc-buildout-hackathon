import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { ARC_TESTNET_CHAIN_ID } from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import {
  findWalletByNormalizedAddress,
  principalHasWalletAccess,
} from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import { normalizeEvmAddress } from '@/server/infrastructure/db/repositories/wallet-repository';
import { devices } from '@/server/infrastructure/db/schema';
import { ApiError } from '@/server/transport/http/api-error';

export type LatestAgentDevice = {
  readonly deviceId: string;
  readonly externalDeviceId: string;
  readonly displayName: string | null;
  readonly vendor: string | null;
  readonly model: string | null;
  readonly walletAddress: string;
  readonly network: string | null;
  readonly nftTokenId: string | null;
};

/**
 * Newest onboarded device for a wallet the principal may access.
 * Prefers Enode-linked devices (enode_connection_id set), then newest created_at.
 */
export async function getLatestAgentDevice(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  walletAddress: string;
}): Promise<LatestAgentDevice> {
  const env = getServerEnv();
  const chainId = BigInt(env.ARC_CHAIN_ID ?? Number(ARC_TESTNET_CHAIN_ID));
  const normalized = normalizeEvmAddress(input.walletAddress);

  const wallet = await findWalletByNormalizedAddress(
    input.db,
    chainId,
    normalized,
  );
  if (wallet === null) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet or device not found.',
      status: 404,
    });
  }

  const allowed = await principalHasWalletAccess(
    input.db,
    input.principal.principalId,
    wallet.id,
  );
  if (!allowed) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Wallet or device not found.',
      status: 404,
    });
  }

  const [row] = await input.db
    .select({
      id: devices.id,
      externalDeviceId: devices.externalDeviceId,
      displayName: devices.displayName,
      vendor: devices.vendor,
      model: devices.model,
      network: devices.network,
      nftTokenId: devices.nftTokenId,
    })
    .from(devices)
    .where(and(eq(devices.walletId, wallet.id), eq(devices.status, 'active')))
    .orderBy(
      asc(
        sql`case when ${devices.enodeConnectionId} is null then 1 else 0 end`,
      ),
      desc(devices.createdAt),
      desc(devices.id),
    )
    .limit(1);

  if (row === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'No onboarded device for wallet.',
      status: 404,
    });
  }

  return {
    deviceId: row.id,
    externalDeviceId: row.externalDeviceId,
    displayName: row.displayName,
    vendor: row.vendor,
    model: row.model,
    walletAddress: wallet.address,
    network: row.network,
    nftTokenId: row.nftTokenId,
  };
}
