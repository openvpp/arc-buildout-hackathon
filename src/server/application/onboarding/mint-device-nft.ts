import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

/**
 * Reserve a device row and enqueue its `MINT_DEVICE_NFT` job. Sets `pending`
 * only when there is nothing on-chain yet; a device that already has a
 * token id (or an in-flight claim) is left untouched. Called from onboarding
 * finalize; the actual mint runs in the worker (see network-provider /
 * device-nft / the worker loop), never inside an HTTP request.
 */
export async function enqueueDeviceMint(
  db: Database,
  outboxEnqueue: (input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) => Promise<void>,
  input: { deviceId: string; walletAddress: string },
): Promise<void> {
  await db
    .update(devices)
    .set({ mintStatus: 'pending', mintClaimedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(devices.id, input.deviceId),
        or(isNull(devices.nftTokenId), eq(devices.nftTokenId, '')),
        ne(devices.mintStatus, 'minted'),
        sql`(${devices.mintStatus} <> 'pending' or ${devices.mintClaimedAt} is null)`,
      ),
    );

  await outboxEnqueue({
    aggregateType: 'device',
    aggregateId: input.deviceId,
    eventType: 'MINT_DEVICE_NFT',
    payload: { deviceId: input.deviceId, walletAddress: input.walletAddress },
  });
}
