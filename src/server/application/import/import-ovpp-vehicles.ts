import { and, count, eq, inArray, sql } from 'drizzle-orm';

import {
  mapOvppVehicle,
  type MappedOvppVehicle,
} from '@/server/application/import/map-ovpp-vehicle';
import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import { devices, wallets } from '@/server/infrastructure/db/schema';

const WRITE_BATCH = 100;

export type OvppVehicleImportSummary = {
  read: number;
  imported: number;
  inserted: number;
  updated: number;
  leftExisting: number;
  located: number;
  walletsCreated: number;
  walletsReused: number;
  skipped: Record<string, number>;
};

/**
 * Upsert legacy OVPP vehicles. Wallets are `imported_legacy` placeholders
 * keyed by the old owner address so the public globe can render pins.
 * They are not Circle wallets and are not bound to a Google principal.
 * Re-running updates only rows this import created (`legacySource`).
 * Mint columns are never written.
 */
export async function importOvppVehicles(
  db: DatabaseExecutor,
  input: { documents: readonly unknown[]; chainId: bigint },
): Promise<OvppVehicleImportSummary> {
  const skipped: Record<string, number> = {};
  const byKey = new Map<string, MappedOvppVehicle>();

  for (const document of input.documents) {
    const mapped = mapOvppVehicle(document);
    if (!mapped.ok) {
      skipped[mapped.reason] = (skipped[mapped.reason] ?? 0) + 1;
      continue;
    }
    byKey.set(
      `${mapped.vehicle.provider}:${mapped.vehicle.vehicleId}`,
      mapped.vehicle,
    );
  }

  const vehicles = [...byKey.values()];
  const owners = [...new Set(vehicles.map((vehicle) => vehicle.ownerAddress))];
  const walletIds = await ensureLegacyWallets(db, owners, input.chainId);

  const before = await countLegacyDevices(db);
  let written = 0;

  for (const batch of chunks(vehicles, WRITE_BATCH)) {
    const values = batch.map((vehicle) => {
      const walletId = walletIds.get(vehicle.ownerAddress);
      if (walletId === undefined) {
        throw new Error(
          `Missing legacy wallet for an owner address after insert.`,
        );
      }
      return {
        walletId,
        provider: vehicle.provider,
        externalDeviceId: vehicle.vehicleId,
        deviceType: 'electric_vehicle' as const,
        vendor: vehicle.vendor,
        model: vehicle.model,
        displayName: vehicle.displayName,
        status: vehicle.status,
        metadata: vehicle.metadata,
        mintStatus: 'unminted' as const,
        lastLatitude: vehicle.latitude,
        lastLongitude: vehicle.longitude,
        lastLocationAt: vehicle.lastLocationAt,
        lastSeenAt: vehicle.lastSeenAt,
        updatedAt: vehicle.updatedAt ?? new Date(),
        ...(vehicle.createdAt !== null ? { createdAt: vehicle.createdAt } : {}),
      };
    });

    const writtenRows = await db
      .insert(devices)
      .values(values)
      .onConflictDoUpdate({
        target: [devices.provider, devices.externalDeviceId],
        set: {
          walletId: sql`excluded.wallet_id`,
          vendor: sql`excluded.vendor`,
          model: sql`excluded.model`,
          displayName: sql`excluded.display_name`,
          status: sql`excluded.status`,
          metadata: sql`excluded.metadata`,
          lastLatitude: sql`excluded.last_latitude`,
          lastLongitude: sql`excluded.last_longitude`,
          lastLocationAt: sql`excluded.last_location_at`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`${devices.metadata}->>'legacySource' = 'ovpp-vehicles'`,
      })
      .returning({ id: devices.id });

    written += writtenRows.length;
  }

  const inserted = (await countLegacyDevices(db)) - before;
  const updated = written - inserted;
  const leftExisting = vehicles.length - written;

  return {
    read: input.documents.length,
    imported: vehicles.length,
    inserted,
    updated,
    leftExisting,
    located: vehicles.filter((vehicle) => vehicle.latitude !== null).length,
    walletsCreated: walletIds.created,
    walletsReused: owners.length - walletIds.created,
    skipped,
  };
}

async function ensureLegacyWallets(
  db: DatabaseExecutor,
  addresses: readonly string[],
  chainId: bigint,
): Promise<Map<string, string> & { created: number }> {
  let created = 0;
  for (const batch of chunks(addresses, WRITE_BATCH)) {
    const inserted = await db
      .insert(wallets)
      .values(
        batch.map((address) => ({
          chainId,
          address,
          normalizedAddress: address,
          walletType: 'imported_legacy',
          label: 'Imported OVPP vehicle owner',
          status: 'active' as const,
        })),
      )
      .onConflictDoNothing({
        target: [wallets.chainId, wallets.normalizedAddress],
      })
      .returning({ id: wallets.id });
    created += inserted.length;
  }

  const ids = new Map<string, string>();
  for (const batch of chunks(addresses, WRITE_BATCH)) {
    const rows = await db
      .select({
        id: wallets.id,
        normalizedAddress: wallets.normalizedAddress,
      })
      .from(wallets)
      .where(
        and(
          eq(wallets.chainId, chainId),
          inArray(wallets.normalizedAddress, [...batch]),
        ),
      );
    for (const row of rows) {
      ids.set(row.normalizedAddress, row.id);
    }
  }

  if (ids.size !== addresses.length) {
    throw new Error(
      `Legacy wallet insert resolved ${ids.size} of ${addresses.length} owner addresses.`,
    );
  }

  return Object.assign(ids, { created });
}

async function countLegacyDevices(db: DatabaseExecutor): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(devices)
    .where(sql`${devices.metadata}->>'legacySource' = 'ovpp-vehicles'`);
  return Number(row?.total ?? 0);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
