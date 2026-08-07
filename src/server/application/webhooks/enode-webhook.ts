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
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
import {
  findDeviceByExternalId,
  insertTelemetryRecord,
  insertWebhookDelivery,
} from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import { withTransaction } from '@/server/infrastructure/db/transaction';
import {
  decodeEnodeUserId,
  wireEnvironmentForAppEnv,
} from '@/server/infrastructure/enode/user-id';
import {
  coerceEnodeVehicleEvent,
  extractEnodeEventUserId,
  extractEnodeWebhookEvents,
  isEmptyTelemetryData,
  mapUnifiedEnodeVehicleEvent,
  summarizeEnodeWebhookEventTypes,
} from '@/server/infrastructure/enode/webhook-mapper';
import { verifyEnodeWebhook } from '@/server/infrastructure/enode/webhook-verifier';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import { ApiError } from '@/server/transport/http/api-error';

const log = createServerLogger({ component: 'enode-webhook' });

export async function receiveEnodeWebhook(input: {
  db: Database;
  rawBody: Buffer;
  headers: Record<string, string>;
  signatureHeader: string | null;
  deliveryHeader?: string | null;
}): Promise<{ deliveryId: string; duplicate: boolean; dropped?: boolean }> {
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
  const events = extractEnodeWebhookEvents(parsed);
  const eventType = summarizeEnodeWebhookEventTypes(events);

  // Tenancy guard: Enode delivers every event on the account to every registered
  // webhook, so a shared Enode account fans other environments' events (and their
  // mint/telemetry side effects) into this backend. Drop deliveries whose events
  // all belong to another environment. Events with no attributable user id
  // (e.g. schedule/test pings) fail open and are kept.
  const appWireEnv = wireEnvironmentForAppEnv(getServerEnv().APP_ENV);
  const belongsToThisEnv = (rawEvent: unknown): boolean => {
    const userId = extractEnodeEventUserId(rawEvent);
    if (userId === null) return true;
    return decodeEnodeUserId(userId).environment === appWireEnv;
  };
  if (events.length > 0 && !events.some(belongsToThisEnv)) {
    log.info('enode.webhook_foreign_env_dropped', {
      events: events.length,
      appWireEnv,
      eventType,
    });
    return { deliveryId: payloadHash, duplicate: false, dropped: true };
  }

  const deliveryIdHeader =
    input.deliveryHeader !== undefined &&
    input.deliveryHeader !== null &&
    input.deliveryHeader.trim().length > 0
      ? input.deliveryHeader.trim()
      : null;

  const providerEventId = deliveryIdHeader;
  const dedupeKey = providerEventId ?? payloadHash;

  try {
    const delivery = await withTransaction(input.db, async (tx) => {
      const row = await insertWebhookDelivery(tx, {
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

      await enqueueOutboxEvent(tx, {
        aggregateType: 'webhook_delivery',
        aggregateId: row.id,
        eventType: 'PROCESS_ENODE_WEBHOOK',
        payload: { webhookDeliveryId: row.id },
      });

      return row;
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

  const events = extractEnodeWebhookEvents(delivery.rawPayload);
  if (events.length === 0) {
    await input.db
      .update(webhookDeliveries)
      .set({
        processingStatus: 'unsupported',
        processedAt: new Date(),
        lastErrorCode: 'UNSUPPORTED_EVENT',
        lastErrorMessage: 'Webhook body had no events',
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return;
  }

  let ingested = 0;
  let skippedUnsupported = 0;
  let skippedDuplicate = 0;
  let skippedEmpty = 0;
  let missingDevices = 0;
  const missingDeviceIds: string[] = [];

  for (let index = 0; index < events.length; index += 1) {
    const rawEvent = events[index];
    const coerced = coerceEnodeVehicleEvent(rawEvent);
    if (coerced === null) {
      skippedUnsupported += 1;
      continue;
    }

    const mapped = mapUnifiedEnodeVehicleEvent(coerced);

    // A bare `user:vehicle:discovered` (or any event with no readings) would
    // otherwise anchor an all-null telemetry record. Skip it — and do so before
    // the device lookup so an empty event never forces a missing-device retry.
    if (isEmptyTelemetryData(mapped.data)) {
      skippedEmpty += 1;
      continue;
    }

    const sourceEventId =
      mapped.sourceEventId ??
      `${delivery.providerEventId ?? delivery.id}:${mapped.externalDeviceId}:${coerced.createdAt ?? index}`;

    const device = await findDeviceByExternalId(
      input.db,
      mapped.externalDeviceId,
    );
    if (device === null) {
      missingDevices += 1;
      missingDeviceIds.push(mapped.externalDeviceId);
      continue;
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
        sourceEventId,
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
      ingested += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('unique') || message.includes('duplicate')) {
        skippedDuplicate += 1;
        continue;
      }
      throw error;
    }
  }

  const vehicleEvents = events.length - skippedUnsupported;

  if (vehicleEvents === 0) {
    await input.db
      .update(webhookDeliveries)
      .set({
        processingStatus: 'unsupported',
        processedAt: new Date(),
        lastErrorCode: 'UNSUPPORTED_EVENT',
        lastErrorMessage: 'No vehicle telemetry events in delivery',
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    return;
  }

  // Unknown Enode vehicle IDs are skipped (not onboarded yet / other tenants).
  // Do not fail or retry the delivery — known devices in the batch stay ingested.
  const summaryParts = [
    `ingested=${ingested}`,
    `duplicate=${skippedDuplicate}`,
    `missing=${missingDevices}`,
    `empty=${skippedEmpty}`,
    `unsupported=${skippedUnsupported}`,
  ];
  if (missingDeviceIds.length > 0) {
    summaryParts.push(`ids=${missingDeviceIds.slice(0, 5).join(', ')}`);
  }
  const hasSkips =
    skippedEmpty > 0 || missingDevices > 0 || skippedDuplicate > 0;

  await input.db
    .update(webhookDeliveries)
    .set({
      processingStatus: 'processed',
      processedAt: new Date(),
      lastErrorCode: null,
      lastErrorMessage: hasSkips ? summaryParts.join(' ') : null,
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  if (missingDevices > 0) {
    log.info('enode.webhook_skipped_unknown_devices', {
      webhookDeliveryId: delivery.id,
      missingDevices,
      missingDeviceIds: missingDeviceIds.slice(0, 10),
    });
  }

  log.info('enode.webhook_processed', {
    webhookDeliveryId: delivery.id,
    ingested,
    skippedDuplicate,
    skippedEmpty,
    missingDevices,
    skippedUnsupported,
  });
}
