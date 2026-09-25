import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { processEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import { devices, webhookDeliveries } from '@/server/infrastructure/db/schema';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

async function seedDevice() {
  const { wallet } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const externalDeviceId = randomUUID();
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId,
      deviceType: 'vehicle',
    })
    .returning();
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return device;
}

describe('processEnodeWebhook', () => {
  it('rejects an invalid signature without writing a delivery row', async () => {
    const result = await processEnodeWebhook(db, {
      rawBody: '{}',
      deliveryIdHeader: randomUUID(),
      signatureValid: false,
    });
    expect(result).toEqual({ status: 'invalid_signature' });
  });

  it('updates device location from a valid user:vehicle:updated event', async () => {
    const device = await seedDevice();
    const deliveryId = randomUUID();
    const rawBody = JSON.stringify([
      {
        event: 'user:vehicle:updated',
        vehicle: {
          id: device.externalDeviceId,
          location: { latitude: 37.7749, longitude: -122.4194 },
        },
      },
    ]);

    const result = await processEnodeWebhook(db, {
      rawBody,
      deliveryIdHeader: deliveryId,
      signatureValid: true,
    });
    expect(result).toEqual({ status: 'processed', eventsHandled: 1 });

    const [row] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, device.id))
      .limit(1);
    expect(row?.lastLatitude).toBe('37.774900');
    expect(row?.lastLongitude).toBe('-122.419400');
  });

  it('deduplicates a repeated delivery id instead of processing twice', async () => {
    const device = await seedDevice();
    const deliveryId = randomUUID();
    const rawBody = JSON.stringify([
      {
        event: 'user:vehicle:updated',
        vehicle: {
          id: device.externalDeviceId,
          location: { latitude: 1, longitude: 2 },
        },
      },
    ]);

    const first = await processEnodeWebhook(db, {
      rawBody,
      deliveryIdHeader: deliveryId,
      signatureValid: true,
    });
    const second = await processEnodeWebhook(db, {
      rawBody,
      deliveryIdHeader: deliveryId,
      signatureValid: true,
    });

    expect(first.status).toBe('processed');
    expect(second).toEqual({ status: 'duplicate' });

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.deliveryId, deliveryId));
    expect(deliveries).toHaveLength(1);
  });

  it('does not crash on an unknown event type', async () => {
    const rawBody = JSON.stringify([
      { event: 'user:schedule:execution-updated' },
    ]);
    const result = await processEnodeWebhook(db, {
      rawBody,
      deliveryIdHeader: randomUUID(),
      signatureValid: true,
    });
    expect(result).toEqual({ status: 'processed', eventsHandled: 0 });
  });
});
