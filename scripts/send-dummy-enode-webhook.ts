/**
 * POST a signed, fake Enode `user:vehicle:updated` webhook to the local API.
 * Exercises webhook → outbox → worker → telemetry_records for nanopayment demos.
 *
 * Prerequisites:
 *   - pnpm run dev
 *   - pnpm worker:dev
 *   - at least one onboarded device in Postgres
 *   - ENODE_WEBHOOK_SECRET set (matches server .env.local)
 *
 * Usage:
 *   pnpm demo:dummy-webhook
 *   EXTERNAL_DEVICE_ID=<enode-vehicle-uuid> pnpm demo:dummy-webhook
 */
import { randomUUID } from 'node:crypto';

import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../src/server/infrastructure/db/schema';
import { devices } from '../src/server/infrastructure/db/schema/index';
import { signEnodeWebhookBody } from '../src/server/infrastructure/enode/webhook-verifier';

async function resolveVehicleId(databaseUrl: string): Promise<{
  vehicleId: string;
  deviceId: string;
  displayName: string | null;
}> {
  const override = process.env['EXTERNAL_DEVICE_ID']?.trim();
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { schema });

  try {
    if (override !== undefined && override.length > 0) {
      const [row] = await db
        .select({
          id: devices.id,
          externalDeviceId: devices.externalDeviceId,
          displayName: devices.displayName,
        })
        .from(devices)
        .where(eq(devices.externalDeviceId, override))
        .limit(1);
      if (row === undefined) {
        throw new Error(
          `No device with external_device_id=${override}. Onboard a vehicle first.`,
        );
      }
      return {
        vehicleId: row.externalDeviceId,
        deviceId: row.id,
        displayName: row.displayName,
      };
    }

    const [row] = await db
      .select({
        id: devices.id,
        externalDeviceId: devices.externalDeviceId,
        displayName: devices.displayName,
      })
      .from(devices)
      .where(eq(devices.status, 'active'))
      .orderBy(desc(devices.createdAt))
      .limit(1);

    if (row === undefined) {
      throw new Error(
        'No active devices. Complete /devices/onboard before sending a dummy webhook.',
      );
    }

    return {
      vehicleId: row.externalDeviceId,
      deviceId: row.id,
      displayName: row.displayName,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required');
  }

  const webhookSecret = process.env.ENODE_WEBHOOK_SECRET;
  if (webhookSecret === undefined || webhookSecret.length === 0) {
    throw new Error(
      'ENODE_WEBHOOK_SECRET is required to sign the dummy webhook',
    );
  }

  const apiBase =
    process.env.AGENT_API_BASE_URL?.replace(/\/$/, '') ??
    'http://localhost:3000';

  const device = await resolveVehicleId(databaseUrl);
  const now = new Date();
  // Vary SOC so each inject gets a new content_hash (sellable "new" record).
  const batteryLevel = 40 + Math.floor(Math.random() * 50);
  const createdAt = now.toISOString();

  const payload = {
    event: 'user:vehicle:updated',
    createdAt,
    version: '2024-10-01',
    user: { id: 'dummy-webhook-user' },
    vehicle: {
      id: device.vehicleId,
      userId: 'dummy-webhook-user',
      vendor: 'TESLA',
      chargeState: {
        batteryLevel,
        isCharging: batteryLevel < 80,
        isPluggedIn: true,
        range: 180 + batteryLevel,
        chargeRate: 11.2,
        lastUpdated: createdAt,
      },
      odometer: {
        distance: 12_000 + Math.floor(Math.random() * 500),
        lastUpdated: createdAt,
      },
      location: {
        latitude: 37.7749,
        longitude: -122.4194,
        lastUpdated: createdAt,
      },
    },
    updatedFields: ['chargeState', 'odometer', 'location'],
    _demo: true,
  };

  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = signEnodeWebhookBody(rawBody, webhookSecret);
  const deliveryId = `dummy-${randomUUID()}`;

  const url = `${apiBase}/api/webhooks/enode`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-enode-signature': signature,
      'x-enode-delivery': deliveryId,
    },
    body: rawBody,
  });

  const responseText = await response.text();
  console.log(`POST ${url} → ${response.status}`);
  console.log(responseText);
  console.log('');
  console.log(`deviceId:          ${device.deviceId}`);
  console.log(`displayName:       ${device.displayName ?? '(none)'}`);
  console.log(`externalDeviceId:  ${device.vehicleId}`);
  console.log(`batteryLevel:      ${batteryLevel}`);
  console.log(`x-enode-delivery:  ${deliveryId}`);
  console.log('');
  if (response.status === 202 || response.status === 200) {
    console.log(
      'Accepted. Wait for worker to process PROCESS_ENODE_WEBHOOK, then Request latest on /dashboard.',
    );
  } else {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
