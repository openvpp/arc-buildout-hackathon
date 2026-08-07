import { and, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import {
  buildSimpleDeviceMetadataUri,
  createDeviceNftMinter,
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
 *
 * Ported from ovpp-backend `mintProviderDeviceIfNeeded`: idempotent by
 * `nft_token_id`, claim-before-mint (only one worker/pod wins the row), and
 * crash-safe — the tx hash is persisted the instant it is broadcast, so a
 * failure after broadcast is reconciled against the in-flight tx instead of
 * minting a duplicate NFT. Runs from the `MINT_DEVICE_NFT` worker job, never in
 * an HTTP request.
 */
export async function mintDeviceNftIfNeeded(input: {
  db: Database;
  deviceId: string;
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

  const minter = createDeviceNftMinter();
  if (minter === null) {
    // Not configured for Arc mint — reset to unminted so a later (configured)
    // run can retry, and complete the job rather than retrying forever.
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

  // Claim-before-mint: atomically reserve this row. Claimable when it has no
  // token id and is not already minted, and is either not pending or its
  // pending claim is stale (lease expired).
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
          lt(devices.mintClaimedAt, staleBoundary),
        ),
      ),
    )
    .returning();

  if (claimed === undefined) {
    // Lost the race (another worker holds a fresh claim) or already minted.
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

  // Crash-safe reconcile: a prior attempt may have broadcast a tx but died
  // before recording the token id. Adopt that tx instead of minting again.
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

  // Holder (not a plain `let`) so the flag set inside the onBroadcast closure is
  // visible to the catch block — TS control-flow can't narrow a closure-mutated
  // local otherwise.
  const broadcast: { hash: string | null } = { hash: null };
  try {
    const minted = await minter.mintDevice({
      to: walletAddress,
      typeId,
      deviceURI,
      onBroadcast: async (hash) => {
        // Persist the hash before confirmation so a crash reconciles, never re-mints.
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
      // Tx is out there — keep the row pending + hash so the next run reconciles.
      log.warn('mint.errored_after_broadcast', {
        deviceId,
        transactionHash: broadcast.hash,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } else {
      // Never broadcast — release the claim so a retry can proceed cleanly.
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
 * only when there is nothing on-chain yet; a device that already has a token id
 * (or an in-flight claim) is left untouched. Runs inside onboarding finalize.
 */
export async function enqueueDeviceMint(
  db: Database,
  outboxEnqueue: (input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) => Promise<unknown>,
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
    payload: {
      deviceId: input.deviceId,
      walletAddress: input.walletAddress,
    },
  });
}
