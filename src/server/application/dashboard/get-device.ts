import { and, eq } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

export async function getDeviceForWallet(
  db: Database,
  input: { deviceId: string; walletId: string },
) {
  const [device] = await db
    .select()
    .from(devices)
    .where(
      and(eq(devices.id, input.deviceId), eq(devices.walletId, input.walletId)),
    )
    .limit(1);
  return device ?? null;
}
