import { createHash } from 'node:crypto';

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';

import { recordVehicleTelemetry } from '@/server/application/telemetry/record-vehicle-telemetry';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { devices, webhookDeliveries } from '@/server/infrastructure/db/schema';
import {
  extractEnodeWebhookEvents,
  mapEnodeWebhookEvent,
} from '@/server/infrastructure/enode/webhook-mapper';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'enode-webhook' });

function deliveryIdFor(
  rawBody: string,
  headerDeliveryId: string | null,
): string {
  if (headerDeliveryId !== null && headerDeliveryId.length > 0) {
    return headerDeliveryId;
  }
  return createHash('sha256').update(rawBody).digest('hex');
}

export type ProcessEnodeWebhookResult =
  | { status: 'processed'; eventsHandled: number }
  // Some events failed; the delivery is marked 'failed' so a redelivery of
  // the same id is reprocessed (all per-event writes are idempotent).
  | { status: 'failed'; eventsHandled: number; eventsFailed: number }
  | { status: 'duplicate' }
  | { status: 'invalid_signature' };

export async function processEnodeWebhook(
  db: Database,
  input: {
    rawBody: string;
    deliveryIdHeader: string | null;
    signatureValid: boolean;
  },
): Promise<ProcessEnodeWebhookResult> {
  if (!input.signatureValid) {
    return { status: 'invalid_signature' };
  }
  const deliveryId = deliveryIdFor(input.rawBody, input.deliveryIdHeader);

  const [delivery] = await db
    .insert(webhookDeliveries)
    .values({
      provider: 'enode',
      deliveryId,
      rawBody: input.rawBody,
      status: 'received',
    })
    .onConflictDoUpdate({
      target: [webhookDeliveries.provider, webhookDeliveries.deliveryId],
      set: { status: 'received', error: null, processedAt: null },
      where: eq(webhookDeliveries.status, 'failed'),
    })
    .returning();
  if (delivery === undefined) {
    return { status: 'duplicate' };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        error: { message: 'invalid JSON' },
        processedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return { status: 'processed', eventsHandled: 0 };
  }

  const events = extractEnodeWebhookEvents(payload);
  const electricityPricePerKwh = getServerEnv().ELECTRICITY_PRICE_USD_PER_KWH;
  let handled = 0;
  let failed = 0;
  let firstError: string | null = null;
  for (const raw of events) {
    const mapped = mapEnodeWebhookEvent(raw);
    if (mapped === null) {
      // Unknown/irrelevant event type — never crash ingestion for these.
      continue;
    }
    const receivedAt = new Date();
    try {
      await db.transaction(async (tx) => {
        // Vendor-scoped lookup; the row lock serializes all telemetry for
        // this device so concurrent deliveries can't race a session or day.
        const [device] = await tx
          .select({ id: devices.id, status: devices.status })
          .from(devices)
          .where(
            and(
              eq(devices.provider, 'enode'),
              eq(devices.externalDeviceId, mapped.vehicleId),
            ),
          )
          .limit(1)
          .for('update');
        if (device === undefined) {
          return;
        }

        // Any vehicle event means the vehicle reported in; never move
        // last_seen_at backwards for a late, out-of-order delivery.
        const seenAt = (mapped.occurredAt ?? receivedAt).toISOString();
        await tx
          .update(devices)
          .set({
            lastSeenAt: sql`greatest(coalesce(${devices.lastSeenAt}, ${seenAt}::timestamptz), ${seenAt}::timestamptz)`,
          })
          .where(eq(devices.id, device.id));

        if (mapped.latitude !== null && mapped.longitude !== null) {
          const observedAt = mapped.occurredAt ?? receivedAt;
          await tx
            .update(devices)
            .set({
              lastLatitude: mapped.latitude.toFixed(6),
              lastLongitude: mapped.longitude.toFixed(6),
              lastLocationAt: observedAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(devices.id, device.id),
                mapped.occurredAt === null
                  ? undefined
                  : or(
                      isNull(devices.lastLocationAt),
                      lte(devices.lastLocationAt, mapped.occurredAt),
                    ),
              ),
            );
        }

        // A disconnected vehicle's telemetry is not part of its time series.
        if (device.status !== 'active') {
          return;
        }
        const telemetry = await recordVehicleTelemetry(tx, {
          deviceId: device.id,
          event: mapped,
          webhookDeliveryId: delivery.id,
          receivedAt,
          electricityPricePerKwh,
        });
        if (telemetry.charging !== 'none' || telemetry.odometer !== 'none') {
          log.info('enode.webhook.telemetry', {
            deviceId: device.id,
            odometer: telemetry.odometer,
            charging: telemetry.charging,
          });
        }
      });
      handled += 1;
    } catch (error) {
      // One bad event must not block the rest of the delivery.
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      firstError ??= message;
      log.error('enode.webhook.event_failed', {
        deliveryId,
        eventName: mapped.eventName,
        errorMessage: message,
      });
    }
  }

  if (failed > 0) {
    await db
      .update(webhookDeliveries)
      .set({
        status: 'failed',
        error: { message: firstError, eventsFailed: failed },
        processedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return { status: 'failed', eventsHandled: handled, eventsFailed: failed };
  }

  await db
    .update(webhookDeliveries)
    .set({ status: 'processed', processedAt: new Date() })
    .where(eq(webhookDeliveries.id, delivery.id));

  log.info('enode.webhook.processed', { deliveryId, eventsHandled: handled });
  return { status: 'processed', eventsHandled: handled };
}
