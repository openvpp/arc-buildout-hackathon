import { createHash } from 'node:crypto';

import {
  TELEMETRY_CANONICALIZATION_VERSION,
  TELEMETRY_HASH_ALGORITHM,
  TELEMETRY_SCHEMA_VERSION,
} from '@/server/config/constants';
import { getServerEnv } from '@/server/config/env';
import type { OutboxRepository } from '@/server/domain/shared/ports';
import {
  buildCanonicalTelemetryDocument,
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
} from '@/server/domain/telemetry/canonical';
import type { Database } from '@/server/infrastructure/db/client';
import {
  findDeviceByExternalId,
  insertTelemetryRecord,
  insertWebhookDelivery,
} from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import {
  enodeVehicleTelemetryEventSchema,
  mapEnodeEventToNormalizedTelemetry,
} from '@/server/infrastructure/enode/webhook-mapper';
import { verifyEnodeWebhook } from '@/server/infrastructure/enode/webhook-verifier';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';

const log = createServerLogger({ component: 'enode-webhook' });

export async function receiveEnodeWebhook(input: {
  db: Database;
  outbox: OutboxRepository;
  rawBody: Buffer;
  headers: Record<string, string>;
  signatureHeader: string | null;
}): Promise<{ deliveryId: string; duplicate: boolean }> {
  const verified = verifyEnodeWebhook({
    rawBody: input.rawBody,
    signatureHeader: input.signatureHeader,
  });
  if (!verified.ok) {
    throw new ApiError({
      code: 'ENODE_WEBHOOK_INVALID',
      message: verified.reason,
      status: 401,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody.toString('utf8')) as unknown;
  } catch {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Webhook body must be JSON.',
      status: 400,
    });
  }

  const payloadHash = createHash('sha256').update(input.rawBody).digest('hex');

  const eventType =
    typeof parsed === 'object' &&
    parsed !== null &&
    'type' in parsed &&
    typeof parsed.type === 'string'
      ? parsed.type
      : 'unknown';

  const providerEventId =
    typeof parsed === 'object' &&
    parsed !== null &&
    'eventId' in parsed &&
    typeof parsed.eventId === 'string'
      ? parsed.eventId
      : typeof parsed === 'object' &&
          parsed !== null &&
          'id' in parsed &&
          typeof parsed.id === 'string'
        ? parsed.id
        : null;

  const dedupeKey = providerEventId ?? payloadHash;

  try {
    const delivery = await insertWebhookDelivery(input.db, {
      provider: 'enode',
      providerEventId,
      dedupeKey,
      eventType,
      signature: input.signatureHeader,
      headers: input.headers,
      rawPayload: parsed,
      payloadHash,
      processingStatus: 'queued',
    });

    await input.outbox.enqueue({
      aggregateType: 'webhook_delivery',
      aggregateId: delivery.id,
      eventType: 'PROCESS_ENODE_WEBHOOK',
      payload: { webhookDeliveryId: delivery.id },
    });

    return { deliveryId: delivery.id, duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('unique') || message.includes('duplicate')) {
      return { deliveryId: dedupeKey, duplicate: true };
    }
    throw error;
  }
}

export async function processEnodeWebhookDelivery(input: {
  db: Database;
  outbox: OutboxRepository;
  webhookDeliveryId: string;
}): Promise<void> {
  const env = getServerEnv();
  const { webhookDeliveries } =
    await import('@/server/infrastructure/db/schema');
  const { eq } = await import('drizzle-orm');

  const [delivery] = await input.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, input.webhookDeliveryId))
    .limit(1);

  if (delivery === undefined) {
    log.warn('enode.webhook_missing', {
      webhookDeliveryId: input.webhookDeliveryId,
    });
    return;
  }

  if (delivery.processingStatus === 'processed') {
    return;
  }

  const parsed = enodeVehicleTelemetryEventSchema.safeParse(
    delivery.rawPayload,
  );
  if (!parsed.success) {
    await input.db
      .update(webhookDeliveries)
      .set({
        processingStatus: 'unsupported',
        processedAt: new Date(),
        lastErrorCode: 'UNSUPPORTED_EVENT',
        lastErrorMessage: 'Event shape not supported for telemetry ingestion',
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return;
  }

  const mapped = mapEnodeEventToNormalizedTelemetry(parsed.data);
  const device = await findDeviceByExternalId(
    input.db,
    mapped.externalDeviceId,
  );
  if (device === null) {
    await input.db
      .update(webhookDeliveries)
      .set({
        processingStatus: 'failed',
        lastErrorCode: 'DEVICE_NOT_FOUND',
        lastErrorMessage: `No device for external id ${mapped.externalDeviceId}`,
        attemptCount: delivery.attemptCount + 1,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    throw new Error(`Device not found: ${mapped.externalDeviceId}`);
  }

  const receivedAt = delivery.receivedAt;
  const recordedAt = mapped.sourceObservedAt ?? receivedAt;
  const canonical = buildCanonicalTelemetryDocument({
    deviceId: device.id,
    source: 'enode',
    sourceObservedAt: mapped.sourceObservedAt,
    recordedAt,
    receivedAt,
    data: mapped.data,
  });
  const canonicalJson = canonicalizeTelemetry(canonical);
  const { contentHash } = hashCanonicalTelemetry(canonicalJson);

  try {
    const record = await insertTelemetryRecord(input.db, {
      deviceId: device.id,
      source: 'enode',
      sourceEventId: mapped.sourceEventId,
      sourceObservedAt: mapped.sourceObservedAt,
      receivedAt,
      recordedAt,
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      telemetryPayload: mapped.data,
      canonicalPayload: canonical,
      canonicalizationVersion: TELEMETRY_CANONICALIZATION_VERSION,
      contentHashAlgorithm: TELEMETRY_HASH_ALGORITHM,
      contentHash,
      anchorStatus: 'unanchored',
      dataOrigin:
        env.APP_ENV === 'production' ? 'ENODE_PRODUCTION' : 'ENODE_SANDBOX',
    });

    await input.outbox.enqueue({
      aggregateType: 'telemetry_record',
      aggregateId: record.id,
      eventType: 'ANCHOR_TELEMETRY',
      payload: { telemetryRecordId: record.id, contentHash },
    });

    await input.db
      .update(webhookDeliveries)
      .set({
        processingStatus: 'processed',
        processedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('unique') || message.includes('duplicate')) {
      await input.db
        .update(webhookDeliveries)
        .set({
          processingStatus: 'processed',
          processedAt: new Date(),
        })
        .where(eq(webhookDeliveries.id, delivery.id));
      return;
    }
    throw error;
  }
}
