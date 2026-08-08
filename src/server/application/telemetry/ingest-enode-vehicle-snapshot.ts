import {
  TELEMETRY_CANONICALIZATION_VERSION,
  TELEMETRY_HASH_ALGORITHM,
  TELEMETRY_SCHEMA_VERSION,
} from '@/server/config/constants';
import { getServerEnv } from '@/server/config/env';
import {
  buildCanonicalTelemetryDocument,
  canonicalizeTelemetry,
  hashCanonicalTelemetry,
} from '@/server/domain/telemetry/canonical';
import type { Database } from '@/server/infrastructure/db/client';
import { enqueueOutboxEvent } from '@/server/infrastructure/db/repositories/outbox-repository';
import { insertTelemetryRecord } from '@/server/infrastructure/db/repositories/telemetry-payment-repository';
import {
  isEmptyTelemetryData,
  mapEnodeVehicleApiToTelemetry,
} from '@/server/infrastructure/enode/webhook-mapper';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'enode-vehicle-snapshot' });

export type EnodeVehicleSnapshotSource =
  'enode-onboard-snapshot' | 'enode-api-sync';

export type IngestEnodeVehicleSnapshotResult =
  | { readonly status: 'inserted'; readonly telemetryRecordId: string }
  | { readonly status: 'skipped_empty' }
  | { readonly status: 'skipped_unmapped' }
  | { readonly status: 'duplicate' };

/**
 * Persist one telemetry row from an Enode GET `/vehicles/{id}` body.
 * Idempotent within the same UTC minute via sourceEventId.
 */
export async function ingestEnodeVehicleSnapshot(input: {
  readonly db: Database;
  readonly deviceId: string;
  readonly externalDeviceId: string;
  readonly rawVehicle: unknown;
  readonly source: EnodeVehicleSnapshotSource;
  readonly now?: Date;
}): Promise<IngestEnodeVehicleSnapshotResult> {
  const mapped = mapEnodeVehicleApiToTelemetry(input.rawVehicle);
  if (mapped === null) {
    return { status: 'skipped_unmapped' };
  }
  if (isEmptyTelemetryData(mapped.data)) {
    return { status: 'skipped_empty' };
  }

  const now = input.now ?? new Date();
  const receivedAt = now;
  const recordedAt = mapped.sourceObservedAt ?? receivedAt;
  const minuteBucket = Math.floor(now.getTime() / 60_000);
  const sourceEventId = `${input.source}:${input.externalDeviceId}:${minuteBucket}`;

  const env = getServerEnv();
  const canonical = buildCanonicalTelemetryDocument({
    deviceId: input.deviceId,
    source: input.source,
    sourceObservedAt: mapped.sourceObservedAt,
    recordedAt,
    receivedAt,
    data: mapped.data,
  });
  const canonicalJson = canonicalizeTelemetry(canonical);
  const { contentHash } = hashCanonicalTelemetry(canonicalJson);

  try {
    const record = await insertTelemetryRecord(input.db, {
      deviceId: input.deviceId,
      source: input.source,
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

    await enqueueOutboxEvent(input.db, {
      aggregateType: 'telemetry_record',
      aggregateId: record.id,
      eventType: 'ANCHOR_TELEMETRY',
      payload: { telemetryRecordId: record.id, contentHash },
    });

    return { status: 'inserted', telemetryRecordId: record.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('unique') || message.includes('duplicate')) {
      log.info('enode.snapshot.duplicate', {
        deviceId: input.deviceId,
        source: input.source,
      });
      return { status: 'duplicate' };
    }
    throw error;
  }
}

/** Best-effort wrapper for onboarding paths that must not fail finalize. */
export async function tryIngestEnodeVehicleSnapshot(input: {
  readonly db: Database;
  readonly deviceId: string;
  readonly externalDeviceId: string;
  readonly rawVehicle: unknown;
  readonly source: EnodeVehicleSnapshotSource;
}): Promise<void> {
  try {
    const result = await ingestEnodeVehicleSnapshot(input);
    log.info('enode.snapshot.result', {
      deviceId: input.deviceId,
      source: input.source,
      status: result.status,
      ...(result.status === 'inserted'
        ? { telemetryRecordId: result.telemetryRecordId }
        : {}),
    });
  } catch (error) {
    log.warn('enode.snapshot.failed', {
      deviceId: input.deviceId,
      source: input.source,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
