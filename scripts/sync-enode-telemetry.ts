/**
 * Pull latest Enode vehicle charge/odometer/location via GET /vehicles/{id}
 * and insert a telemetry snapshot for active devices.
 *
 * Usage:
 *   pnpm enode:sync-telemetry -- --missing-only
 *   pnpm enode:sync-telemetry -- --device-id <uuid>
 */
import { and, desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { ingestEnodeVehicleSnapshot } from '../src/server/application/telemetry/ingest-enode-vehicle-snapshot';
import * as schema from '../src/server/infrastructure/db/schema';
import {
  devices,
  telemetryRecords,
} from '../src/server/infrastructure/db/schema/index';
import { createHttpEnodeVehicleClient } from '../src/server/infrastructure/enode/http-client';

type CliOptions = {
  readonly deviceId: string | null;
  readonly missingOnly: boolean;
};

function parseArgs(argv: readonly string[]): CliOptions {
  let deviceId: string | null = null;
  let missingOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--missing-only') {
      missingOnly = true;
      continue;
    }
    if (arg === '--device-id') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error('--device-id requires a uuid value');
      }
      deviceId = next;
      i += 1;
      continue;
    }
    if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { deviceId, missingOnly };
}

function latestMissingSocOrCapacity(
  payload: Record<string, unknown> | null,
): boolean {
  if (payload === null) {
    return true;
  }
  const soc = payload['stateOfChargePercent'];
  const capacity = payload['batteryCapacityKilowattHours'];
  const hasSoc = typeof soc === 'number' && !Number.isNaN(soc);
  const hasCapacity =
    typeof capacity === 'number' && !Number.isNaN(capacity) && capacity >= 0;
  return !(hasSoc && hasCapacity);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  const opts = parseArgs(process.argv.slice(2));
  const sqlClient = postgres(url, { max: 1 });
  const db = drizzle(sqlClient, { schema });
  const client = createHttpEnodeVehicleClient(db);

  const conditions = [eq(devices.status, 'active')];
  if (opts.deviceId !== null) {
    conditions.push(eq(devices.id, opts.deviceId));
  }

  const rows = await db
    .select({
      id: devices.id,
      displayName: devices.displayName,
      externalDeviceId: devices.externalDeviceId,
      metadata: devices.metadata,
    })
    .from(devices)
    .where(and(...conditions));

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const device of rows) {
    if (opts.missingOnly) {
      const [latest] = await db
        .select({
          telemetryPayload: telemetryRecords.telemetryPayload,
        })
        .from(telemetryRecords)
        .where(eq(telemetryRecords.deviceId, device.id))
        .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
        .limit(1);

      const payload = latest === undefined ? null : latest.telemetryPayload;

      if (!latestMissingSocOrCapacity(payload)) {
        console.log(
          `skip ${device.id} (${device.displayName ?? device.externalDeviceId}): latest has SoC+capacity`,
        );
        skipped += 1;
        continue;
      }
    }

    const metadata = device.metadata ?? {};
    const enodeUserId =
      typeof metadata['enodeUserId'] === 'string'
        ? metadata['enodeUserId']
        : '';

    try {
      const raw = await client.getUserVehicleById(
        enodeUserId,
        device.externalDeviceId,
      );
      if (raw === null) {
        console.log(
          `fail ${device.id}: Enode returned no vehicle for ${device.externalDeviceId}`,
        );
        failed += 1;
        continue;
      }

      const result = await ingestEnodeVehicleSnapshot({
        db,
        deviceId: device.id,
        externalDeviceId: device.externalDeviceId,
        rawVehicle: raw,
        source: 'enode-api-sync',
      });

      if (result.status === 'inserted') {
        console.log(
          `ok   ${device.id} (${device.displayName ?? device.externalDeviceId}): inserted ${result.telemetryRecordId}`,
        );
        inserted += 1;
      } else {
        console.log(
          `skip ${device.id} (${device.displayName ?? device.externalDeviceId}): ${result.status}`,
        );
        skipped += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      console.log(`fail ${device.id}: ${message}`);
      failed += 1;
    }
  }

  console.log('');
  console.log(
    `Done. devices=${rows.length} inserted=${inserted} skipped=${skipped} failed=${failed}`,
  );

  await sqlClient.end({ timeout: 5 });
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
