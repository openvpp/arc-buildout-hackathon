import { and, eq } from 'drizzle-orm';

import { ensureWalletForAddress } from '@/server/application/onboarding/ensure-wallet';
import { enqueueDeviceMint } from '@/server/application/onboarding/mint-device-nft';
import { tryIngestEnodeVehicleSnapshot } from '@/server/application/telemetry/ingest-enode-vehicle-snapshot';
import type { Database } from '@/server/infrastructure/db/client';
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
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

  let rawVehicle: Record<string, unknown> | null = null;
  let mapped = null as ReturnType<typeof mapEnodeVehicle>;
  try {
    rawVehicle = await client.getUserVehicleById(enodeUserId, providerDeviceId);
    mapped = mapEnodeVehicle(rawVehicle);
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
    const device = existingDevice;
    const needsMint =
      device.nftTokenId === null || device.nftTokenId.length === 0;
    if (needsMint) {
      // Mint runs in the worker (crash-safe, retryable) — never in this request.
      await enqueueDeviceMint(db, (i) => enqueueOutboxEvent(db, i), {
        deviceId: device.id,
        walletAddress: wallet.address,
      });
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

    if (rawVehicle !== null) {
      await tryIngestEnodeVehicleSnapshot({
        db,
        deviceId: device.id,
        externalDeviceId: mapped.vehicleId,
        rawVehicle,
        source: 'enode-onboard-snapshot',
      });
    }

    return {
      device,
      wasExistingDevice: true,
      mintStatus: needsMint ? 'pending' : device.mintStatus,
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

  const needsMint =
    device.nftTokenId === null || device.nftTokenId.length === 0;
  if (needsMint) {
    // Mint runs in the worker (crash-safe, retryable) — never in this request.
    await enqueueDeviceMint(db, (i) => enqueueOutboxEvent(db, i), {
      deviceId: device.id,
      walletAddress: wallet.address,
    });
  }

  await db
    .update(pendingDeviceConnections)
    .set({
      status: 'completed',
      completedAt: new Date(),
      providerDeviceId: mapped.vehicleId,
      providerUserId: enodeUserId,
      resultDeviceId: device.id,
      formData: { ...fd, mergedAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, pending.id));

  if (rawVehicle !== null) {
    await tryIngestEnodeVehicleSnapshot({
      db,
      deviceId: device.id,
      externalDeviceId: mapped.vehicleId,
      rawVehicle,
      source: 'enode-onboard-snapshot',
    });
  }

  return {
    device,
    wasExistingDevice: false,
    mintStatus: needsMint ? 'pending' : device.mintStatus,
  };
}
