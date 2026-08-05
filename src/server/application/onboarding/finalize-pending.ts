import { and, eq } from 'drizzle-orm';

import { ensureWalletForAddress } from '@/server/application/onboarding/ensure-wallet';
import { getServerEnv } from '@/server/config/env';
import {
  buildSimpleDeviceMetadataUri,
  createDeviceNftMinter,
} from '@/server/infrastructure/blockchain/device-nft';
import { arcNetworkLabel } from '@/server/infrastructure/blockchain/network-provider';
import type { Database } from '@/server/infrastructure/db/client';
import { normalizeEvmAddress } from '@/server/infrastructure/db/repositories/wallet-repository';
import {
  devices,
  enodeConnections,
  pendingDeviceConnections,
} from '@/server/infrastructure/db/schema';
import { createHttpEnodeVehicleClient } from '@/server/infrastructure/enode/http-client';
import { encodeEnodeUserId } from '@/server/infrastructure/enode/user-id';
import {
  mapEnodeVehicle,
  pickEnodeVehicleIdFromList,
} from '@/server/infrastructure/enode/vehicle-mapper';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'finalize-pending' });

function throwWithCode(message: string, code: string): never {
  const e = new Error(message) as Error & { code: string };
  e.code = code;
  throw e;
}

export async function finalizePendingVehicleConnection(
  db: Database,
  input: {
    pendingConnectionId: string;
    walletAddress: string;
    formData?: Record<string, unknown>;
  },
) {
  const [pending] = await db
    .select()
    .from(pendingDeviceConnections)
    .where(eq(pendingDeviceConnections.id, input.pendingConnectionId))
    .limit(1);

  if (pending === undefined) {
    throwWithCode(
      'Pending connection not found',
      'PENDING_CONNECTION_NOT_FOUND',
    );
  }

  const normalized = normalizeEvmAddress(input.walletAddress);
  if (pending.normalizedWalletAddress !== normalized) {
    throwWithCode(
      'wallet does not match pending connection',
      'USER_ID_MISMATCH',
    );
  }
  if (pending.expiresAt < new Date() && pending.status !== 'completed') {
    await db
      .update(pendingDeviceConnections)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(pendingDeviceConnections.id, pending.id));
    throwWithCode('Connection window expired', 'PENDING_EXPIRED');
  }
  if (['expired', 'failed', 'cancelled'].includes(pending.status)) {
    throwWithCode(
      `Cannot complete pending in status ${pending.status}`,
      'PENDING_INVALID_STATUS',
    );
  }
  if (pending.status === 'pending_oauth') {
    throwWithCode('OAuth not complete', 'PENDING_OAUTH_INCOMPLETE');
  }
  if (pending.status === 'completed') {
    throwWithCode('Pending already completed', 'PENDING_CONNECTION_COMPLETED');
  }
  if (!['oauth_completed', 'pending_form'].includes(pending.status)) {
    throwWithCode(
      `Invalid status: ${pending.status}`,
      'PENDING_INVALID_STATUS',
    );
  }

  const fd = input.formData ?? {};
  if (fd['consentAccepted'] === false) {
    throwWithCode('Consent is required to complete', 'CONSENT_REQUIRED');
  }

  const wallet = await ensureWalletForAddress(db, input.walletAddress);
  const enodeUserId = encodeEnodeUserId(pending.environment, wallet.address);
  const client = createHttpEnodeVehicleClient(db);

  let providerDeviceId = pending.providerDeviceId;
  if (providerDeviceId === null || providerDeviceId.length === 0) {
    try {
      const list = await client.getUserVehicles(enodeUserId);
      providerDeviceId =
        pickEnodeVehicleIdFromList(list, pending.normalizedBrand) ?? null;
    } catch {
      /* best-effort */
    }
  }
  if (providerDeviceId === null || providerDeviceId.length === 0) {
    throwWithCode('Provider device not linked yet', 'PENDING_OAUTH_INCOMPLETE');
  }

  let mapped = null as ReturnType<typeof mapEnodeVehicle>;
  try {
    const raw = await client.getUserVehicleById(enodeUserId, providerDeviceId);
    mapped = mapEnodeVehicle(raw);
  } catch {
    mapped = null;
  }
  if (mapped === null) {
    mapped = {
      vehicleId: providerDeviceId,
      make: pending.brand,
      model: 'Vehicle',
      year: new Date().getFullYear(),
    };
  }

  const nickname =
    (typeof fd['nickname'] === 'string' && fd['nickname'].trim()) ||
    (typeof fd['deviceName'] === 'string' && fd['deviceName'].trim()) ||
    mapped.displayName ||
    `${mapped.make} ${mapped.model}`;

  const [existingDevice] = await db
    .select()
    .from(devices)
    .where(eq(devices.externalDeviceId, mapped.vehicleId))
    .limit(1);

  if (existingDevice !== undefined && existingDevice.status === 'active') {
    let device = existingDevice;
    let mintWarning: string | null = null;
    if (
      existingDevice.nftTokenId === null ||
      existingDevice.nftTokenId.length === 0
    ) {
      const mintResult = await tryMintDeviceNft({
        deviceId: existingDevice.id,
        walletAddress: wallet.address,
        vehicleId: mapped.vehicleId,
        displayName: existingDevice.displayName ?? nickname,
        make: mapped.make,
        model: mapped.model,
        year: mapped.year,
        db,
      });
      mintWarning = mintResult.warning;
      if (mintResult.device !== null) {
        device = mintResult.device;
      }
    }

    await db
      .update(pendingDeviceConnections)
      .set({
        status: 'completed',
        completedAt: new Date(),
        providerDeviceId: mapped.vehicleId,
        resultDeviceId: device.id,
        formData: { ...fd, mergedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(pendingDeviceConnections.id, pending.id));

    return {
      device,
      wasExistingDevice: true,
      mintWarning,
    };
  }

  const [connection] = await db
    .insert(enodeConnections)
    .values({
      externalUserId: enodeUserId,
      walletId: wallet.walletId,
      status: 'connected',
      connectedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: enodeConnections.externalUserId,
      set: {
        walletId: wallet.walletId,
        status: 'connected',
        lastSyncedAt: new Date(),
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  let device = existingDevice;
  if (device === undefined) {
    const [created] = await db
      .insert(devices)
      .values({
        walletId: wallet.walletId,
        enodeConnectionId: connection?.id ?? null,
        externalDeviceId: mapped.vehicleId,
        deviceType: 'vehicle',
        vendor: mapped.make,
        model: mapped.model,
        displayName: nickname,
        status: 'active',
        lastSeenAt: new Date(),
        metadata: {
          year: mapped.year,
          provider: 'enode',
          enodeUserId,
        },
      })
      .returning();
    device = created;
  } else {
    const [reactivated] = await db
      .update(devices)
      .set({
        walletId: wallet.walletId,
        enodeConnectionId: connection?.id ?? null,
        vendor: mapped.make,
        model: mapped.model,
        displayName: nickname,
        status: 'active',
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(devices.id, device.id)))
      .returning();
    device = reactivated ?? device;
  }

  if (device === undefined) {
    throwWithCode('Failed to persist device', 'DEVICE_PERSIST_FAILED');
  }

  let mintWarning: string | null = null;
  let mintedDevice = device;
  if (device.nftTokenId === null || device.nftTokenId.length === 0) {
    const mintResult = await tryMintDeviceNft({
      deviceId: device.id,
      walletAddress: wallet.address,
      vehicleId: mapped.vehicleId,
      displayName: nickname,
      make: mapped.make,
      model: mapped.model,
      year: mapped.year,
      db,
    });
    mintWarning = mintResult.warning;
    if (mintResult.device !== null) {
      mintedDevice = mintResult.device;
    }
  }

  await db
    .update(pendingDeviceConnections)
    .set({
      status: 'completed',
      completedAt: new Date(),
      providerDeviceId: mapped.vehicleId,
      providerUserId: enodeUserId,
      resultDeviceId: mintedDevice.id,
      formData: { ...fd, mergedAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, pending.id));

  return {
    device: mintedDevice,
    wasExistingDevice: false,
    mintWarning,
  };
}

async function tryMintDeviceNft(input: {
  db: Database;
  deviceId: string;
  walletAddress: string;
  vehicleId: string;
  displayName: string;
  make: string | null;
  model: string | null;
  year: number | null;
}): Promise<{
  device: typeof devices.$inferSelect | null;
  warning: string | null;
}> {
  const env = getServerEnv();
  const minter = createDeviceNftMinter();
  if (minter === null) {
    log.info('finalize.mint_skipped', {
      reason: 'DeviceNFT mint not configured for Arc',
      deviceId: input.deviceId,
    });
    return {
      device: null,
      warning:
        'Device linked; DeviceNFT mint skipped (Arc mint env incomplete).',
    };
  }

  const deviceURI = buildSimpleDeviceMetadataUri({
    vehicleId: input.vehicleId,
    displayName: input.displayName,
    make: input.make,
    model: input.model,
    year: input.year,
    walletAddress: input.walletAddress,
  });

  try {
    const minted = await minter.mintDevice({
      to: input.walletAddress,
      typeId: BigInt(env.DEVICE_NFT_TYPE_ID),
      deviceURI,
    });

    const contractAddress = env.DEVICE_NFT_CONTRACT_ADDRESS ?? null;
    const [updated] = await input.db
      .update(devices)
      .set({
        nftTokenId: minted.tokenId,
        nftContractAddress: contractAddress,
        nftTransactionHash: minted.transactionHash,
        nftMetadataUri: deviceURI,
        network: arcNetworkLabel(env),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, input.deviceId))
      .returning();

    return { device: updated ?? null, warning: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'mint failed';
    log.error('finalize.mint_failed', {
      deviceId: input.deviceId,
      errorMessage: message,
    });
    return {
      device: null,
      warning: `Device linked; DeviceNFT mint failed: ${message}`,
    };
  }
}
