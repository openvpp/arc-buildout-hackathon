import { eq } from 'drizzle-orm';

import {
  buildChargingSessionRecord,
  snapshotDailyOdometerRecord,
} from '@/server/application/telemetry/device-event-record';
import type { DatabaseExecutor } from '@/server/infrastructure/db/client';
import {
  chargingSessions,
  dailyOdometer,
  deviceEvents,
} from '@/server/infrastructure/db/schema';

type DeviceEventRow = typeof deviceEvents.$inferSelect;

/** Who an unlock is for decides what it reveals. */
export type UnlockAudience = 'owner' | 'admin' | 'agent';

/** Fields of a record that place the vehicle; never revealed to agents. */
const LOCATION_FIELDS = ['latitude', 'longitude'] as const;

export type UnlockedRecord =
  | {
      /**
       * The record committed on-chain by `recordHash` (payload v2). With the
       * salt, anyone can recompute keccak256(salt + ":" + json) and compare.
       */
      committed: true;
      json: string;
      /** Only for the owner and admin; an agent's copy omits location. */
      salt: string | null;
      redactedFields: readonly string[];
    }
  | {
      /** A v1 event: the record as stored today, not committed on-chain. */
      committed: false;
      json: string;
      salt: null;
      redactedFields: readonly string[];
    };

export type UnlockedContent = {
  /** The exact published payload (also readable on-chain). */
  payloadJson: string;
  payloadHash: string;
  payloadVersion: number;
  record: UnlockedRecord | null;
};

function withoutLocation(json: string): {
  json: string;
  redacted: string[];
} {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { json, redacted: [] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { json, redacted: [] };
  }
  const record = { ...(value as Record<string, unknown>) };
  const redacted: string[] = [];
  for (const field of LOCATION_FIELDS) {
    if (field in record) {
      delete record[field];
      redacted.push(field);
    }
  }
  return { json: JSON.stringify(record), redacted };
}

/** The record as stored now, for events published without a commitment. */
async function currentRecordJson(
  db: DatabaseExecutor,
  event: DeviceEventRow,
): Promise<string | null> {
  if (event.sourceType === 'charging_session') {
    const [row] = await db
      .select()
      .from(chargingSessions)
      .where(eq(chargingSessions.id, event.sourceId))
      .limit(1);
    return row === undefined ? null : buildChargingSessionRecord(row);
  }
  if (event.sourceType === 'daily_odometer') {
    const [day] = await db
      .select()
      .from(dailyOdometer)
      .where(eq(dailyOdometer.id, event.sourceId))
      .limit(1);
    return day === undefined ? null : snapshotDailyOdometerRecord(db, day);
  }
  return null;
}

/**
 * What an unlocked event reveals. The owner and the admin get the full
 * record and its salt, so the private-record check can be repeated; an
 * agent gets the record without location (and without the salt, which
 * would let it test guesses of the removed fields).
 */
export async function buildUnlockedContent(
  db: DatabaseExecutor,
  event: DeviceEventRow,
  audience: UnlockAudience,
): Promise<UnlockedContent> {
  const committedJson =
    event.payloadVersion === 2 && event.recordJson !== null
      ? event.recordJson
      : null;
  const json = committedJson ?? (await currentRecordJson(db, event));
  let record: UnlockedRecord | null = null;
  if (json !== null) {
    const shown =
      audience === 'agent' ? withoutLocation(json) : { json, redacted: [] };
    record =
      committedJson !== null
        ? {
            committed: true,
            json: shown.json,
            salt: audience === 'agent' ? null : event.recordSalt,
            redactedFields: shown.redacted,
          }
        : {
            committed: false,
            json: shown.json,
            salt: null,
            redactedFields: shown.redacted,
          };
  }
  return {
    payloadJson: event.payloadJson,
    payloadHash: event.payloadHash,
    payloadVersion: event.payloadVersion,
    record,
  };
}
