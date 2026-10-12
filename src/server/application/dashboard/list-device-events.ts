import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { Database } from '@/server/infrastructure/db/client';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';

export type DeviceEventStatus = 'queued' | 'pending' | 'confirmed' | 'failed';

export type DeviceEventSummary =
  | {
      kind: 'charging_completed';
      startTime: string;
      endTime: string;
      energyDeliveredKwh: number;
      batteryLevel: number | null;
      totalCost: number | null;
      currency: string;
    }
  | {
      kind: 'daily_odometer';
      startTime: string;
      distanceMiles: number;
      startOdometerMiles: number;
      endOdometerMiles: number;
    };

export type DeviceTimelineEvent = {
  id: string;
  eventType: number;
  occurredAt: Date;
  /** `confirmed` only ever comes from a confirmed receipt (DB-enforced). */
  status: DeviceEventStatus;
  transactionHash: string | null;
  tokenId: string | null;
  blockNumber: string | null;
  confirmedAt: Date | null;
  /** The exact bytes sent on-chain (as UTF-8) and their keccak256. */
  payloadJson: string;
  payloadHash: string;
  summary: DeviceEventSummary | null;
};

export type DeviceEventPage = {
  events: DeviceTimelineEvent[];
  nextCursor: string | null;
};

const chargingPayloadSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  energyDelivered: z.number(),
  batteryLevel: z.number().nullable(),
  totalCost: z.number().nullable(),
  currency: z.string(),
});

const dailyPayloadSchema = z.object({
  startTime: z.string(),
  distanceTraveled: z.number(),
  startOdometer: z.number(),
  endOdometer: z.number(),
});

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

/** A display summary; null if the payload doesn't match (never guessed). */
export function summarizeDeviceEvent(
  sourceType: string,
  payloadJson: string,
): DeviceEventSummary | null {
  const payload = parseJson(payloadJson);
  if (sourceType === 'charging_session') {
    const parsed = chargingPayloadSchema.safeParse(payload);
    return parsed.success
      ? {
          kind: 'charging_completed',
          startTime: parsed.data.startTime,
          endTime: parsed.data.endTime,
          energyDeliveredKwh: parsed.data.energyDelivered,
          batteryLevel: parsed.data.batteryLevel,
          totalCost: parsed.data.totalCost,
          currency: parsed.data.currency,
        }
      : null;
  }
  if (sourceType === 'daily_odometer') {
    const parsed = dailyPayloadSchema.safeParse(payload);
    return parsed.success
      ? {
          kind: 'daily_odometer',
          startTime: parsed.data.startTime,
          distanceMiles: parsed.data.distanceTraveled,
          startOdometerMiles: parsed.data.startOdometer,
          endOdometerMiles: parsed.data.endOdometer,
        }
      : null;
  }
  return null;
}

function toStatus(value: string): DeviceEventStatus {
  return value === 'pending' || value === 'confirmed' || value === 'failed'
    ? value
    : 'queued';
}

/**
 * A device's on-chain time series, newest first. Returns null when the
 * device doesn't exist or isn't owned by `walletId` (callers show 404, so
 * ownership isn't leaked).
 */
export async function listDeviceEventsForWallet(
  db: Database,
  input: {
    deviceId: string;
    walletId: string;
    limit?: number;
    cursor?: string;
  },
): Promise<DeviceEventPage | null> {
  const limit = Math.min(input.limit ?? 25, 100);
  const cursor = input.cursor !== undefined ? decodeCursor(input.cursor) : null;
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid events cursor.');
  }

  const [owned] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(eq(devices.id, input.deviceId), eq(devices.walletId, input.walletId)),
    )
    .limit(1);
  if (owned === undefined) {
    return null;
  }

  const rows = await db
    .select()
    .from(deviceEvents)
    .where(
      and(
        eq(deviceEvents.deviceId, input.deviceId),
        cursor === null
          ? undefined
          : sql`(${deviceEvents.occurredAt}, ${deviceEvents.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(deviceEvents.occurredAt), desc(deviceEvents.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    events: pageRows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      occurredAt: row.occurredAt,
      status: toStatus(row.status),
      transactionHash: row.transactionHash,
      tokenId: row.tokenId,
      blockNumber: row.blockNumber === null ? null : row.blockNumber.toString(),
      confirmedAt: row.confirmedAt,
      payloadJson: row.payloadJson,
      payloadHash: row.payloadHash,
      summary: summarizeDeviceEvent(row.sourceType, row.payloadJson),
    })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.occurredAt, last.id)
        : null,
  };
}
