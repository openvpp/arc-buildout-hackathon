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
    log.info('job.deferred', {
      jobId: event.id,
      eventType: event.eventType,
      reason:
        'BatchAnchor submission deferred — provenance remains PENDING until adapter lands',
      telemetryRecordId: event.payload['telemetryRecordId'],
    });
  },
  CHECK_ANCHOR_CONFIRMATIONS: async (event) => {
    log.info('job.deferred', {
      jobId: event.id,
      eventType: event.eventType,
      reason: 'Anchor confirmation checks deferred',
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
