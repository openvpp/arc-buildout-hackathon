import { and, eq } from 'drizzle-orm';

import { enqueueDeviceMint } from '@/server/application/onboarding/mint-device-nft';
import type { Database } from '@/server/infrastructure/db/client';
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
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

/**
 * Complete an Enode Link onboarding wizard: persist the device row and
 * enqueue its mint.
 *
 * Duplicate-link safety: devices are keyed by `(provider, external_device_id)`
 * — the same physical vehicle re-linked (same wallet or a different one)
 * updates the existing row instead of creating a second one. This is
 * deliberately NOT scoped by wallet id alone; an earlier implementation
 * scoped disconnect/relink by user id only and ended up deactivating
 * unrelated devices. Don't repeat that mistake here.
 */
export async function finalizePendingVehicleConnection(
  db: Database,
  input: {
    pendingConnectionId: string;
    walletId: string;
    nickname?: string;
    consentAccepted: boolean;
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
  if (pending.walletId !== input.walletId) {
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
  if (pending.status === 'completed') {
    throwWithCode('Pending already completed', 'PENDING_CONNECTION_COMPLETED');
  }
  if (pending.status === 'pending_oauth') {
    throwWithCode('OAuth not complete', 'PENDING_OAUTH_INCOMPLETE');
  }
  if (!input.consentAccepted) {
    throwWithCode('Consent is required to complete', 'CONSENT_REQUIRED');
  }

  const enodeUserId = encodeEnodeUserId(pending.walletId);
  const client = createHttpEnodeVehicleClient();

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
    const rawVehicle = await client.getUserVehicleById(
      enodeUserId,
      providerDeviceId,
    );
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
      latitude: null,
      longitude: null,
    };
  }

  const nickname =
    input.nickname?.trim() ||
    mapped.displayName ||
    `${mapped.make} ${mapped.model}`;

  const [connection] = await db
    .insert(enodeConnections)
    .values({
      externalUserId: enodeUserId,
      walletId: pending.walletId,
      status: 'connected',
      connectedAt: new Date(),
      lastSyncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: enodeConnections.externalUserId,
      set: {
        walletId: pending.walletId,
        status: 'connected',
        lastSyncedAt: new Date(),
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  const [existingDevice] = await db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.provider, 'enode'),
        eq(devices.externalDeviceId, mapped.vehicleId),
      ),
    )
    .limit(1);

  const deviceValues = {
    walletId: pending.walletId,
    enodeConnectionId: connection?.id ?? null,
    vendor: mapped.make,
    model: mapped.model,
    displayName: nickname,
    status: 'active' as const,
    lastSeenAt: new Date(),
    ...(mapped.latitude !== null && mapped.longitude !== null
      ? {
          lastLatitude: mapped.latitude.toFixed(6),
          lastLongitude: mapped.longitude.toFixed(6),
          lastLocationAt: new Date(),
        }
      : {}),
    updatedAt: new Date(),
  };

  let device;
  if (existingDevice !== undefined) {
    const [updated] = await db
      .update(devices)
      .set(deviceValues)
      .where(eq(devices.id, existingDevice.id))
      .returning();
    device = updated ?? existingDevice;
  } else {
    const [created] = await db
      .insert(devices)
      .values({
        provider: 'enode',
        externalDeviceId: mapped.vehicleId,
        deviceType: 'vehicle',
        metadata: { year: mapped.year },
        ...deviceValues,
      })
      .onConflictDoUpdate({
        target: [devices.provider, devices.externalDeviceId],
        set: deviceValues,
      })
      .returning();
    if (created === undefined) {
      throwWithCode('Failed to persist device', 'DEVICE_PERSIST_FAILED');
    }
    device = created;
  }

  const needsMint =
    device.nftTokenId === null || device.nftTokenId.length === 0;
  if (needsMint) {
    await enqueueDeviceMint(db, (i) => enqueueOutboxEvent(db, i), {
      deviceId: device.id,
      walletAddress: pending.walletAddress,
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
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, pending.id));

  return {
    device,
    wasExistingDevice: existingDevice !== undefined,
    mintStatus: needsMint ? 'pending' : device.mintStatus,
  };
}
