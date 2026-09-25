import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

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
    .onConflictDoNothing({
      target: [webhookDeliveries.provider, webhookDeliveries.deliveryId],
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
  let handled = 0;
  for (const raw of events) {
    const mapped = mapEnodeWebhookEvent(raw);
    if (mapped === null) {
      // Unknown/irrelevant event type — never crash ingestion for these.
      continue;
    }
    if (mapped.latitude === null || mapped.longitude === null) {
      handled += 1;
      continue;
    }
    await db
      .update(devices)
      .set({
        lastLatitude: mapped.latitude.toFixed(6),
        lastLongitude: mapped.longitude.toFixed(6),
        lastLocationAt: new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(devices.provider, 'enode'),
          eq(devices.externalDeviceId, mapped.vehicleId),
        ),
      );
    handled += 1;
  }

  await db
    .update(webhookDeliveries)
    .set({ status: 'processed', processedAt: new Date() })
    .where(eq(webhookDeliveries.id, delivery.id));

  log.info('enode.webhook.processed', { deliveryId, eventsHandled: handled });
  return { status: 'processed', eventsHandled: handled };
}
