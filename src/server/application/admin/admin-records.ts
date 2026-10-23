import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApplicationError } from '@/server/application/application-error';
import {
  decodeLocationCursor as decodeCursor,
  encodeLocationCursor as encodeCursor,
} from '@/server/application/dashboard/list-device-locations';
import type { Database } from '@/server/infrastructure/db/client';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';

export const recordVerdictFilterSchema = z.enum([
  'verified',
  'verified_with_warnings',
  'unverified',
  'pending',
  'unchecked',
]);
export type RecordVerdictFilter = z.infer<typeof recordVerdictFilterSchema>;

export type AdminRecordRow = {
  id: string;
  deviceId: string;
  deviceName: string | null;
  vendor: string | null;
  eventType: number;
  occurredAt: Date;
  publishStatus: string;
  verificationStatus: string;
  lastVerifiedAt: Date | null;
  transactionHash: string | null;
  payloadVersion: number;
};

/** Anchored records across all devices (admin), optionally by verdict. */
export async function listAdminRecords(
  db: Database,
  input: { verdict?: RecordVerdictFilter; limit?: number; cursor?: string },
): Promise<{ records: AdminRecordRow[]; nextCursor: string | null }> {
  const limit = Math.min(input.limit ?? 50, 100);
  const cursor = input.cursor === undefined ? null : decodeCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid records cursor.');
  }
  // Only the listed columns: record_json (raw readings) and the payload are
  // never needed here.
  const rows = await db
    .select({
      record: {
        id: deviceEvents.id,
        deviceId: deviceEvents.deviceId,
        eventType: deviceEvents.eventType,
        occurredAt: deviceEvents.occurredAt,
        status: deviceEvents.status,
        verificationStatus: deviceEvents.verificationStatus,
        lastVerifiedAt: deviceEvents.lastVerifiedAt,
        transactionHash: deviceEvents.transactionHash,
        payloadVersion: deviceEvents.payloadVersion,
      },
      deviceName: devices.displayName,
      vendor: devices.vendor,
    })
    .from(deviceEvents)
    .innerJoin(devices, eq(devices.id, deviceEvents.deviceId))
    .where(
      and(
        eq(deviceEvents.status, 'confirmed'),
        input.verdict === undefined
          ? undefined
          : eq(deviceEvents.verificationStatus, input.verdict),
        cursor === null
          ? undefined
          : sql`(${deviceEvents.occurredAt}, ${deviceEvents.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(deviceEvents.occurredAt), desc(deviceEvents.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    records: page.map(({ record, deviceName, vendor }) => ({
      id: record.id,
      deviceId: record.deviceId,
      deviceName,
      vendor,
      eventType: record.eventType,
      occurredAt: record.occurredAt,
      publishStatus: record.status,
      verificationStatus: record.verificationStatus,
      lastVerifiedAt: record.lastVerifiedAt,
      transactionHash: record.transactionHash,
      payloadVersion: record.payloadVersion,
    })),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.record.occurredAt, last.record.id)
        : null,
  };
}
