import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import {
  buildSimpleDeviceMetadataUri,
  createDeviceNftMinter,
  type DeviceNftMinter,
} from '@/server/infrastructure/blockchain/device-nft';
import { arcNetworkLabel } from '@/server/infrastructure/blockchain/network-provider';
import type { Database } from '@/server/infrastructure/db/client';
import { devices, wallets } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'mint-device-nft' });

/** A `pending` mint claim older than this is stale and may be reclaimed (crashed worker). */
const MINT_CLAIM_LEASE_MS = 10 * 60 * 1000;

export type MintDeviceNftResult =
  | { status: 'minted'; tokenId: string; transactionHash: string }
  | { status: 'already_minted'; tokenId: string }
  | { status: 'busy' }
  | { status: 'unconfigured' };

function readYear(metadata: unknown): number | null {
  if (metadata !== null && typeof metadata === 'object') {
    const year = (metadata as Record<string, unknown>)['year'];
    if (typeof year === 'number' && Number.isFinite(year)) {
      return year;
    }
  }
  return null;
}

/**
 * Mint a DeviceNFT for a `devices` row when it is not already on-chain.
 * Idempotent by `nft_token_id`; claim-before-mint reserves the row so only
 * one worker wins it; the broadcast tx hash is persisted before
 * confirmation so a crash after broadcast reconciles instead of re-minting.
 * Runs from the worker's `MINT_DEVICE_NFT` job, never inside an HTTP request.
 */
export async function mintDeviceNftIfNeeded(input: {
  db: Database;
  deviceId: string;
  /** Injectable for tests; defaults to the real Arc minter. */
  minterOverride?: DeviceNftMinter | null;
}): Promise<MintDeviceNftResult> {
  const env = getServerEnv();
  const { db, deviceId } = input;

  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (device === undefined) {
    throw new Error(`Device not found for mint: ${deviceId}`);
  }
  if (device.nftTokenId !== null && device.nftTokenId.length > 0) {
    return { status: 'already_minted', tokenId: device.nftTokenId };
  }

  const minter =
    input.minterOverride !== undefined
      ? input.minterOverride
      : createDeviceNftMinter();
  if (minter === null) {
    await db
      .update(devices)
      .set({
        mintStatus: 'unminted',
        mintClaimedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));
    log.info('mint.skipped_unconfigured', { deviceId });
    return { status: 'unconfigured' };
  }

  const [wallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.id, device.walletId))
    .limit(1);
  if (wallet === undefined) {
    throw new Error(`Wallet not found for device mint: ${deviceId}`);
  }
  const walletAddress = wallet.address;
  const typeId = BigInt(env.DEVICE_NFT_TYPE_ID);

  const now = new Date();
  const staleBoundary = new Date(now.getTime() - MINT_CLAIM_LEASE_MS);
  const [claimed] = await db
    .update(devices)
    .set({ mintStatus: 'pending', mintClaimedAt: now, updatedAt: now })
    .where(
      and(
        eq(devices.id, deviceId),
        or(isNull(devices.nftTokenId), eq(devices.nftTokenId, '')),
        ne(devices.mintStatus, 'minted'),
        or(
          ne(devices.mintStatus, 'pending'),
          isNull(devices.mintClaimedAt),
          lt(devices.mintClaimedAt, staleBoundary),
        ),
      ),
    )
    .returning();

  if (claimed === undefined) {
    const [current] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    if (
      current?.nftTokenId !== null &&
      current?.nftTokenId !== undefined &&
      current.nftTokenId.length > 0
    ) {
      return { status: 'already_minted', tokenId: current.nftTokenId };
    }
    return { status: 'busy' };
  }

  if (
    claimed.nftTransactionHash !== null &&
    claimed.nftTransactionHash.length > 0 &&
    (claimed.nftTokenId === null || claimed.nftTokenId.length === 0)
  ) {
    const reconciled = await minter.reconcileMint({
      transactionHash: claimed.nftTransactionHash,
      to: walletAddress,
      typeId,
    });
    if (reconciled !== null) {
      await db
        .update(devices)
        .set({
          mintStatus: 'minted',
          nftTokenId: reconciled.tokenId,
          network: arcNetworkLabel(env),
          updatedAt: new Date(),
        })
        .where(eq(devices.id, deviceId));
      log.info('mint.reconciled', {
        deviceId,
        tokenId: reconciled.tokenId,
        transactionHash: claimed.nftTransactionHash,
      });
      return {
        status: 'minted',
        tokenId: reconciled.tokenId,
        transactionHash: claimed.nftTransactionHash,
      };
    }
  }

  const deviceURI = buildSimpleDeviceMetadataUri({
    vehicleId: device.externalDeviceId,
    displayName: device.displayName ?? device.externalDeviceId,
    make: device.vendor,
    model: device.model,
    year: readYear(device.metadata),
    walletAddress,
  });

  const broadcast: { hash: string | null } = { hash: null };
  try {
    const minted = await minter.mintDevice({
      to: walletAddress,
      typeId,
      deviceURI,
      onBroadcast: async (hash) => {
        broadcast.hash = hash;
        await db
          .update(devices)
          .set({
            mintStatus: 'pending',
            mintClaimedAt: new Date(),
            nftTransactionHash: hash,
            updatedAt: new Date(),
          })
          .where(eq(devices.id, deviceId));
      },
    });

    await db
      .update(devices)
      .set({
        mintStatus: 'minted',
        nftTokenId: minted.tokenId,
        nftContractAddress: env.DEVICE_NFT_CONTRACT_ADDRESS ?? null,
        nftTransactionHash: minted.transactionHash,
        nftMetadataUri: deviceURI,
        network: arcNetworkLabel(env),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, deviceId));

    log.info('mint.success', {
      deviceId,
      tokenId: minted.tokenId,
      transactionHash: minted.transactionHash,
    });
    return {
      status: 'minted',
      tokenId: minted.tokenId,
      transactionHash: minted.transactionHash,
    };
  } catch (error) {
    if (broadcast.hash !== null) {
      log.warn('mint.errored_after_broadcast', {
        deviceId,
        transactionHash: broadcast.hash,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } else {
      await db
        .update(devices)
        .set({
          mintStatus: 'unminted',
          mintClaimedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(devices.id, deviceId));
    }
    throw error;
  }
}

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
