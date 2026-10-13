import { and, desc, eq, sql } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor,
  encodeLocationCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { Database } from '@/server/infrastructure/db/client';
import { chargingSessions } from '@/server/infrastructure/db/schema';

export type PublicChargingSession = {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  energyDeliveredKwh: number;
  energyMethod: string;
  totalCost: number | null;
  currency: string;
};

export type PublicChargingSessionPage = {
  sessions: PublicChargingSession[];
  nextCursor: string | null;
};

/**
 * Charging history for the public device page. Ordered newest first.
 * Coordinates and the provider session id stay in the database: the session
 * id embeds the provider's vehicle id.
 */
export async function listPublicChargingSessions(
  db: Database,
  input: { deviceId: string; limit?: number; cursor?: string },
): Promise<PublicChargingSessionPage> {
  const limit = Math.min(input.limit ?? 20, 100);
  const cursor =
    input.cursor !== undefined ? decodeLocationCursor(input.cursor) : null;
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid sessions cursor.');
  }

  const rows = await db
    .select({
      id: chargingSessions.id,
      status: chargingSessions.status,
      startTime: chargingSessions.startTime,
      endTime: chargingSessions.endTime,
      startBatteryLevel: chargingSessions.startBatteryLevel,
      endBatteryLevel: chargingSessions.endBatteryLevel,
      energyDeliveredKwh: chargingSessions.energyDeliveredKwh,
      energyMethod: chargingSessions.energyMethod,
      totalCost: chargingSessions.totalCost,
      currency: chargingSessions.currency,
    })
    .from(chargingSessions)
    .where(
      and(
        eq(chargingSessions.deviceId, input.deviceId),
        cursor === null
          ? undefined
          : sql`(${chargingSessions.startTime}, ${chargingSessions.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(chargingSessions.startTime), desc(chargingSessions.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    sessions: pageRows.map((row) => ({
      id: row.id,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime,
      startBatteryLevel: numericOrNull(row.startBatteryLevel),
      endBatteryLevel: numericOrNull(row.endBatteryLevel),
      energyDeliveredKwh: Number(row.energyDeliveredKwh),
      energyMethod: row.energyMethod,
      totalCost: numericOrNull(row.totalCost),
      currency: row.currency,
    })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeLocationCursor(last.startTime, last.id)
        : null,
  };
}

function numericOrNull(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
