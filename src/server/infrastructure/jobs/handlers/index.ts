import { mintDeviceNftIfNeeded } from '@/server/application/onboarding/mint-device-nft';
import { checkTelemetryAnchorConfirmations } from '@/server/application/provenance/check-anchor-confirmations';
import { submitTelemetryAnchor } from '@/server/application/provenance/submit-telemetry-anchor';
import { processEnodeWebhookDelivery } from '@/server/application/webhooks/enode-webhook';
import { getContainer } from '@/server/bootstrap/container';
import type { JobHandler } from '@/server/infrastructure/jobs/worker';

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
  MINT_DEVICE_NFT: async (event) => {
    const deviceId = event.payload['deviceId'];
    if (typeof deviceId !== 'string') {
      throw new Error('MINT_DEVICE_NFT missing deviceId');
    }
    const container = getContainer();
    await mintDeviceNftIfNeeded({ db: container.db, deviceId });
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
};
