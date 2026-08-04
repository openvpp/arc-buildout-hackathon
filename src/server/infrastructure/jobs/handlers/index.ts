import { checkTelemetryAnchorConfirmations } from '@/server/application/provenance/check-anchor-confirmations';
import { submitTelemetryAnchor } from '@/server/application/provenance/submit-telemetry-anchor';
import { processEnodeWebhookDelivery } from '@/server/application/webhooks/enode-webhook';
import { getContainer } from '@/server/bootstrap/container';
import type { JobHandler } from '@/server/infrastructure/jobs/worker';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'job-handlers' });

export const foundationJobHandlers: Readonly<Record<string, JobHandler>> = {
  PROCESS_ENODE_WEBHOOK: async (event) => {
    const webhookDeliveryId = event.payload['webhookDeliveryId'];
    if (typeof webhookDeliveryId !== 'string') {
      throw new Error('PROCESS_ENODE_WEBHOOK missing webhookDeliveryId');
    }
    const container = getContainer();
    await processEnodeWebhookDelivery({
      db: container.db,
      outbox: container.outbox,
      webhookDeliveryId,
    });
  },
  VERIFY_ARC_PAYMENT: async (event) => {
    log.info('job.deferred', {
      jobId: event.id,
      eventType: event.eventType,
      reason: 'Arc payment reconciliation deferred',
    });
  },
  ANCHOR_TELEMETRY: async (event) => {
    const telemetryRecordId = event.payload['telemetryRecordId'];
    if (typeof telemetryRecordId !== 'string') {
      throw new Error('ANCHOR_TELEMETRY missing telemetryRecordId');
    }
    const contentHash = event.payload['contentHash'];
    const container = getContainer();
    await submitTelemetryAnchor({
      db: container.db,
      outbox: container.outbox,
      provenanceAnchor: container.provenanceAnchor,
      telemetryRecordId,
      ...(typeof contentHash === 'string' ? { contentHash } : {}),
    });
  },
  CHECK_ANCHOR_CONFIRMATIONS: async (event) => {
    const telemetryRecordId = event.payload['telemetryRecordId'];
    if (typeof telemetryRecordId !== 'string') {
      throw new Error('CHECK_ANCHOR_CONFIRMATIONS missing telemetryRecordId');
    }
    const transactionHash = event.payload['transactionHash'];
    const container = getContainer();
    await checkTelemetryAnchorConfirmations({
      db: container.db,
      provenanceAnchor: container.provenanceAnchor,
      telemetryRecordId,
      ...(typeof transactionHash === 'string' ? { transactionHash } : {}),
    });
  },
  RECONCILE_PAYMENT: async (event) => {
    log.info('job.deferred', {
      jobId: event.id,
      eventType: event.eventType,
      reason: 'Payment reconciliation deferred',
    });
  },
  RECONCILE_DEVICE: async (event) => {
    log.info('job.deferred', {
      jobId: event.id,
      eventType: event.eventType,
      reason: 'Device reconciliation deferred',
    });
  },
};
