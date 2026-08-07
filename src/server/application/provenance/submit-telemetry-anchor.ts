import { eq } from 'drizzle-orm';

import {
  isProvenanceNotReadyError,
  ProvenanceNotReadyError,
} from '@/server/application/provenance/provenance-not-ready-error';
import type {
  OutboxRepository,
  ProvenanceAnchor,
} from '@/server/domain/shared/ports';
import type { Database } from '@/server/infrastructure/db/client';
import { devices, telemetryRecords } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'anchor-telemetry' });

/**
 * Submit a content-hash provenance event for one telemetry record and enqueue
 * confirmation. Uses DeviceNFT.recordDeviceEvent when live (via adapter).
 */
export async function submitTelemetryAnchor(input: {
  db: Database;
  outbox: OutboxRepository;
  provenanceAnchor: ProvenanceAnchor;
  telemetryRecordId: string;
  contentHash?: string;
}): Promise<void> {
  const [row] = await input.db
    .select({
      id: telemetryRecords.id,
      contentHash: telemetryRecords.contentHash,
      anchorStatus: telemetryRecords.anchorStatus,
      anchorTransactionHash: telemetryRecords.anchorTransactionHash,
      deviceId: telemetryRecords.deviceId,
      nftTokenId: devices.nftTokenId,
    })
    .from(telemetryRecords)
    .innerJoin(devices, eq(devices.id, telemetryRecords.deviceId))
    .where(eq(telemetryRecords.id, input.telemetryRecordId))
    .limit(1);

  if (row === undefined) {
    log.warn('provenance.record_missing', {
      telemetryRecordId: input.telemetryRecordId,
    });
    return;
  }

  if (row.anchorStatus === 'anchored') {
    return;
  }

  if (row.anchorStatus === 'submitted' && row.anchorTransactionHash !== null) {
    await input.outbox.enqueue({
      aggregateType: 'telemetry_record',
      aggregateId: row.id,
      eventType: 'CHECK_ANCHOR_CONFIRMATIONS',
      payload: {
        telemetryRecordId: row.id,
        transactionHash: row.anchorTransactionHash,
      },
    });
    return;
  }

  const contentHash = input.contentHash ?? row.contentHash;
  if (contentHash !== row.contentHash) {
    throw new Error(
      'ANCHOR_TELEMETRY contentHash does not match telemetry record',
    );
  }

  if (row.nftTokenId === null || row.nftTokenId.length === 0) {
    log.info('provenance.awaiting_device_nft', {
      telemetryRecordId: row.id,
      deviceId: row.deviceId,
    });
    throw new ProvenanceNotReadyError(
      `DeviceNFT token not minted yet for device ${row.deviceId}; retrying provenance`,
    );
  }

  await input.db
    .update(telemetryRecords)
    .set({ anchorStatus: 'pending' })
    .where(eq(telemetryRecords.id, row.id));

  try {
    const submitted = await input.provenanceAnchor.anchorTelemetry({
      contentHash: row.contentHash,
      telemetryRecordId: row.id,
      tokenId: row.nftTokenId,
    });

    await input.db
      .update(telemetryRecords)
      .set({
        anchorStatus: 'submitted',
        anchorTransactionHash: submitted.transactionHash,
      })
      .where(eq(telemetryRecords.id, row.id));

    await input.outbox.enqueue({
      aggregateType: 'telemetry_record',
      aggregateId: row.id,
      eventType: 'CHECK_ANCHOR_CONFIRMATIONS',
      payload: {
        telemetryRecordId: row.id,
        transactionHash: submitted.transactionHash,
      },
    });
  } catch (error) {
    if (isProvenanceNotReadyError(error)) {
      throw error;
    }
    await input.db
      .update(telemetryRecords)
      .set({ anchorStatus: 'failed' })
      .where(eq(telemetryRecords.id, row.id));
    throw error;
  }
}
