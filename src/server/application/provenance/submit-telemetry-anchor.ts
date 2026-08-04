import { eq } from 'drizzle-orm';

import type {
  OutboxRepository,
  ProvenanceAnchor,
} from '@/server/domain/shared/ports';
import type { Database } from '@/server/infrastructure/db/client';
import { telemetryRecords } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'anchor-telemetry' });

/**
 * Submit a content-hash anchor for one telemetry record and enqueue confirmation.
 */
export async function submitTelemetryAnchor(input: {
  db: Database;
  outbox: OutboxRepository;
  provenanceAnchor: ProvenanceAnchor;
  telemetryRecordId: string;
  contentHash?: string;
}): Promise<void> {
  const [record] = await input.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.id, input.telemetryRecordId))
    .limit(1);

  if (record === undefined) {
    log.warn('provenance.record_missing', {
      telemetryRecordId: input.telemetryRecordId,
    });
    return;
  }

  if (record.anchorStatus === 'anchored') {
    return;
  }

  if (
    record.anchorStatus === 'submitted' &&
    record.anchorTransactionHash !== null
  ) {
    await input.outbox.enqueue({
      aggregateType: 'telemetry_record',
      aggregateId: record.id,
      eventType: 'CHECK_ANCHOR_CONFIRMATIONS',
      payload: {
        telemetryRecordId: record.id,
        transactionHash: record.anchorTransactionHash,
      },
    });
    return;
  }

  const contentHash = input.contentHash ?? record.contentHash;
  if (contentHash !== record.contentHash) {
    throw new Error(
      'ANCHOR_TELEMETRY contentHash does not match telemetry record',
    );
  }

  await input.db
    .update(telemetryRecords)
    .set({ anchorStatus: 'pending' })
    .where(eq(telemetryRecords.id, record.id));

  try {
    const submitted = await input.provenanceAnchor.anchorTelemetry({
      contentHash: record.contentHash,
      telemetryRecordId: record.id,
    });

    await input.db
      .update(telemetryRecords)
      .set({
        anchorStatus: 'submitted',
        anchorTransactionHash: submitted.transactionHash,
      })
      .where(eq(telemetryRecords.id, record.id));

    await input.outbox.enqueue({
      aggregateType: 'telemetry_record',
      aggregateId: record.id,
      eventType: 'CHECK_ANCHOR_CONFIRMATIONS',
      payload: {
        telemetryRecordId: record.id,
        transactionHash: submitted.transactionHash,
      },
    });
  } catch (error) {
    await input.db
      .update(telemetryRecords)
      .set({ anchorStatus: 'failed' })
      .where(eq(telemetryRecords.id, record.id));
    throw error;
  }
}
