import { eq } from 'drizzle-orm';

import type {
  DeviceRecord,
  DeviceRepository,
} from '@/server/domain/shared/ports';

import { devices } from '../schema';
import type { DbOrTx } from '../transaction';

function mapDevice(row: typeof devices.$inferSelect): DeviceRecord {
  return {
    id: row.id,
    walletId: row.walletId,
    enodeConnectionId: row.enodeConnectionId,
    externalDeviceId: row.externalDeviceId,
    deviceType: row.deviceType,
    vendor: row.vendor,
    model: row.model,
    displayName: row.displayName,
    status: row.status,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createDeviceRepository(db: DbOrTx): DeviceRepository {
  return {
    async create(input) {
      const [row] = await db
        .insert(devices)
        .values({
          walletId: input.walletId,
          externalDeviceId: input.externalDeviceId,
          ...(input.deviceType !== undefined
            ? { deviceType: input.deviceType }
            : {}),
          ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          ...(input.displayName !== undefined
            ? { displayName: input.displayName }
            : {}),
          ...(input.enodeConnectionId !== undefined
            ? { enodeConnectionId: input.enodeConnectionId }
            : {}),
        })
        .returning();

      if (row === undefined) {
        throw new Error('Failed to insert device');
      }

      return mapDevice(row);
    },

    async findById(id) {
      const [row] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, id))
        .limit(1);

      return row === undefined ? null : mapDevice(row);
    },

    async listByWallet(walletId) {
      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.walletId, walletId));

      return rows.map(mapDevice);
    },
  };
}
