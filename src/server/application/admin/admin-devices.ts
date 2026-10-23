import { and, count, desc, eq, inArray, max, sql } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import { displayMintStatus } from '@/server/application/dashboard/display-mint-status';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { Database } from '@/server/infrastructure/db/client';
import {
  deviceAddresses,
  deviceEvents,
  devices,
  principalWallets,
  principals,
  wallets,
} from '@/server/infrastructure/db/schema';

export type AdminDeviceRow = {
  id: string;
  displayName: string | null;
  vendor: string | null;
  model: string | null;
  status: string;
  mintStatus: string;
  tokenId: string | null;
  ownerWallet: string;
  ownerAccount: string | null;
  city: string | null;
  createdAt: Date;
  records: {
    total: number;
    anchored: number;
    verified: number;
    warnings: number;
    unverified: number;
    lastAt: Date | null;
  };
};

export type AdminDevicePage = {
  devices: AdminDeviceRow[];
  nextCursor: string | null;
};

const createdAtMs = sql`date_trunc('milliseconds', ${devices.createdAt})`;

/** All devices across wallets (admin), newest first, with record counts. */
export async function listAdminDevices(
  db: Database,
  input: { limit?: number; cursor?: string; onlyWithRecords?: boolean },
): Promise<AdminDevicePage> {
  const limit = Math.min(input.limit ?? 50, 100);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid devices cursor.');
  }
  const rows = await db
    .select({
      device: devices,
      ownerWallet: wallets.address,
      city: deviceAddresses.city,
    })
    .from(devices)
    .innerJoin(wallets, eq(wallets.id, devices.walletId))
    .leftJoin(deviceAddresses, eq(deviceAddresses.deviceId, devices.id))
    .where(
      and(
        // created_at has microseconds but the cursor carries milliseconds:
        // order and compare at millisecond precision so rows sharing the
        // boundary row's millisecond are not skipped.
        cursor === null
          ? undefined
          : sql`(${createdAtMs}, ${devices.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
        input.onlyWithRecords === true
          ? sql`exists (select 1 from ${deviceEvents} where ${deviceEvents.deviceId} = ${devices.id})`
          : undefined,
      ),
    )
    .orderBy(desc(createdAtMs), desc(devices.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const ids = page.map((row) => row.device.id);
  const walletIds = [...new Set(page.map((row) => row.device.walletId))];

  const counts =
    ids.length === 0
      ? []
      : await db
          .select({
            deviceId: deviceEvents.deviceId,
            total: count(),
            anchored:
              sql<number>`count(*) filter (where ${deviceEvents.status} = 'confirmed')`.mapWith(
                Number,
              ),
            verified:
              sql<number>`count(*) filter (where ${deviceEvents.verificationStatus} = 'verified')`.mapWith(
                Number,
              ),
            warnings:
              sql<number>`count(*) filter (where ${deviceEvents.verificationStatus} = 'verified_with_warnings')`.mapWith(
                Number,
              ),
            unverified:
              sql<number>`count(*) filter (where ${deviceEvents.verificationStatus} = 'unverified')`.mapWith(
                Number,
              ),
            lastAt: max(deviceEvents.occurredAt),
          })
          .from(deviceEvents)
          .where(inArray(deviceEvents.deviceId, ids))
          .groupBy(deviceEvents.deviceId);
  const owners =
    walletIds.length === 0
      ? []
      : await db
          .select({
            walletId: principalWallets.walletId,
            account: principals.displayName,
          })
          .from(principalWallets)
          .innerJoin(
            principals,
            eq(principals.id, principalWallets.principalId),
          )
          .where(
            and(
              inArray(principalWallets.walletId, walletIds),
              eq(principalWallets.role, 'owner'),
            ),
          );

  const last = page.at(-1);
  return {
    devices: page.map(({ device, ownerWallet, city }) => {
      const c = counts.find((row) => row.deviceId === device.id);
      return {
        id: device.id,
        displayName: device.displayName,
        vendor: device.vendor,
        model: device.model,
        status: device.status,
        mintStatus: displayMintStatus(device.mintStatus, device.metadata),
        tokenId: device.nftTokenId,
        ownerWallet,
        ownerAccount:
          owners.find((row) => row.walletId === device.walletId)?.account ??
          null,
        city,
        createdAt: device.createdAt,
        records: {
          total: c?.total ?? 0,
          anchored: c?.anchored ?? 0,
          verified: c?.verified ?? 0,
          warnings: c?.warnings ?? 0,
          unverified: c?.unverified ?? 0,
          lastAt: c?.lastAt ?? null,
        },
      };
    }),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.device.createdAt, last.device.id)
        : null,
  };
}
