/**
 * Insert one explicitly marked demo telemetry row for the seed device.
 * Never pretends this is live Enode production data.
 *
 * Usage (after seed):
 *   pnpm demo:inject-telemetry
 */
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import {
  TELEMETRY_CANONICALIZATION_VERSION,
  TELEMETRY_HASH_ALGORITHM,
  TELEMETRY_SCHEMA_VERSION,
} from '../src/server/config/constants';
import {
  buildCanonicalTelemetryDocument,
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
} from '../src/server/domain/telemetry/canonical';
import { enqueueOutboxEvent } from '../src/server/infrastructure/db/repositories/outbox-repository';
import * as schema from '../src/server/infrastructure/db/schema';
import {
  devices,
  telemetryRecords,
  wallets,
} from '../src/server/infrastructure/db/schema/index';

const DEMO_EXTERNAL_DEVICE_ID = 'demo-enode-vehicle-1';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema });

  const [device] = await db
    .select({
      id: devices.id,
      walletId: devices.walletId,
      displayName: devices.displayName,
      externalDeviceId: devices.externalDeviceId,
    })
    .from(devices)
    .where(eq(devices.externalDeviceId, DEMO_EXTERNAL_DEVICE_ID))
    .limit(1);

  if (device === undefined) {
    await sql.end({ timeout: 5 });
    throw new Error(
      `Demo device not found (externalDeviceId=${DEMO_EXTERNAL_DEVICE_ID}). Run pnpm db:seed first.`,
    );
  }

  const [wallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(eq(wallets.id, device.walletId))
    .limit(1);

  const now = new Date();
  const data = {
    stateOfChargePercent: 72,
    batteryCapacityKilowattHours: 75,
    isCharging: true,
    isPluggedIn: true,
    rangeKilometers: 280,
    odometerKilometers: 12_450,
    chargeRateKilowatts: 11.2,
    powerKilowatts: null,
    latitude: 37.7749,
    longitude: -122.4194,
  };

  const canonicalDoc = buildCanonicalTelemetryDocument({
    deviceId: device.id,
    source: 'demo-inject',
    sourceObservedAt: now,
    recordedAt: now,
    receivedAt: now,
    data,
  });
  const canonicalJson = canonicalizeTelemetry(canonicalDoc);
  const { contentHash } = hashCanonicalTelemetry(canonicalJson);

  const [record] = await db
    .insert(telemetryRecords)
    .values({
      deviceId: device.id,
      source: 'demo-inject',
      sourceEventId: `demo-inject-${now.toISOString()}`,
      sourceObservedAt: now,
      receivedAt: now,
      recordedAt: now,
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      telemetryPayload: { ...data, demo: true },
      canonicalPayload: JSON.parse(canonicalJson) as Record<string, unknown>,
      canonicalizationVersion: TELEMETRY_CANONICALIZATION_VERSION,
      contentHashAlgorithm: TELEMETRY_HASH_ALGORITHM,
      contentHash,
      dataOrigin: 'ENODE_SANDBOX',
      anchorStatus: 'unanchored',
    })
    .returning({
      id: telemetryRecords.id,
      contentHash: telemetryRecords.contentHash,
    });

  if (record === undefined) {
    await sql.end({ timeout: 5 });
    throw new Error('Failed to insert demo telemetry');
  }

  await enqueueOutboxEvent(db, {
    aggregateType: 'telemetry_record',
    aggregateId: record.id,
    eventType: 'ANCHOR_TELEMETRY',
    payload: {
      telemetryRecordId: record.id,
      contentHash: record.contentHash,
    },
  });

  await sql.end({ timeout: 5 });

  console.log(
    'Demo telemetry injected (explicitly marked demo / ENODE_SANDBOX).',
  );
  console.log(`telemetryRecordId: ${record.id}`);
  console.log(`contentHash: ${record.contentHash}`);
  console.log(`deviceId: ${device.id}`);
  console.log(`walletAddress: ${wallet?.address ?? '(unknown)'}`);
  console.log(
    'Queued ANCHOR_TELEMETRY outbox job (run pnpm worker:dev to mock-anchor).',
  );
  console.log(
    'Re-run this script to create a newer unpaid record for another agent poll.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
