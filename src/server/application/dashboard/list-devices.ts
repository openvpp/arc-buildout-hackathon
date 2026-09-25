import { desc, eq } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

export type DashboardDevice = typeof devices.$inferSelect;

/** Devices owned by one wallet, newest first. Paginated (default page size 50). */
export async function listDevicesForWallet(
  db: Database,
  input: { walletId: string; limit?: number },
): Promise<DashboardDevice[]> {
  const limit = Math.min(input.limit ?? 50, 100);
  return db
    .select()
    .from(devices)
    .where(eq(devices.walletId, input.walletId))
    .orderBy(desc(devices.createdAt))
    .limit(limit);
}
