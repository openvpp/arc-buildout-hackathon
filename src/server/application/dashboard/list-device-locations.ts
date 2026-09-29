import { and, desc, isNotNull, sql } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import type { Database } from '@/server/infrastructure/db/client';
import { devices } from '@/server/infrastructure/db/schema';

export type DeviceLocation = {
  id: string;
  displayName: string | null;
  externalDeviceId: string;
  vendor: string | null;
  deviceType: string;
  mintStatus: string;
  latitude: number;
  longitude: number;
};

export type DeviceLocationPage = {
  locations: DeviceLocation[];
  nextCursor: string | null;
};

const CURSOR_SEPARATOR = '|';

export function encodeLocationCursor(at: Date, id: string): string {
  return Buffer.from(
    `${at.toISOString()}${CURSOR_SEPARATOR}${id}`,
    'utf8',
  ).toString('base64url');
}

export function decodeLocationCursor(
  cursor: string,
): { at: Date; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = decoded.lastIndexOf(CURSOR_SEPARATOR);
  if (separator <= 0) {
    return null;
  }
  const at = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(at.getTime())) {
    return null;
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return null;
  }
  return { at, id };
}

/**
 * Every device with a known location, across every wallet — the globe is a
 * public view of the whole connected fleet, not scoped to who (if anyone)
 * is signed in. Devices without coordinates are omitted. Pages are ordered
 * by the location timestamp (falling back to created_at) so a later page
 * cannot skip or repeat a row when two fixes share a timestamp.
 */
export async function listAllDeviceLocations(
  db: Database,
  input?: { limit?: number; cursor?: string },
): Promise<DeviceLocationPage> {
  const limit = Math.min(input?.limit ?? 100, 200);
  const cursor =
    input?.cursor !== undefined ? decodeLocationCursor(input.cursor) : null;
  if (input?.cursor !== undefined && cursor === null) {
    throw new ApplicationError('INVALID_CURSOR', 'Invalid locations cursor.');
  }

  const sortAt = sql<Date>`coalesce(${devices.lastLocationAt}, ${devices.createdAt})`;
  const rows = await db
    .select({
      id: devices.id,
      displayName: devices.displayName,
      externalDeviceId: devices.externalDeviceId,
      vendor: devices.vendor,
      deviceType: devices.deviceType,
      mintStatus: devices.mintStatus,
      lastLatitude: devices.lastLatitude,
      lastLongitude: devices.lastLongitude,
      lastLocationAt: devices.lastLocationAt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .where(
      and(
        isNotNull(devices.lastLatitude),
        isNotNull(devices.lastLongitude),
        cursor === null
          ? undefined
          : sql`(${sortAt}, ${devices.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(sortAt), desc(devices.id))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const locations = pageRows
    .filter((row) => row.lastLatitude !== null && row.lastLongitude !== null)
    .map((row) => ({
      id: row.id,
      displayName: row.displayName,
      externalDeviceId: row.externalDeviceId,
      vendor: row.vendor,
      deviceType: row.deviceType,
      mintStatus: row.mintStatus,
      latitude: Number(row.lastLatitude),
      longitude: Number(row.lastLongitude),
    }));

  const last = pageRows.at(-1);
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeLocationCursor(last.lastLocationAt ?? last.createdAt, last.id)
      : null;

  return { locations, nextCursor };
}
