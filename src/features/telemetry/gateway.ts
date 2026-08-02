import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';
import type { DeviceId, WalletId } from '@/types/branded';

import {
  contentHashSchema,
  parseTelemetryRequestResult,
  telemetryRecordIdSchema,
  type TelemetryRequestResult,
} from './schemas';

/**
 * Explicit integration seam for telemetry retrieval.
 *
 * The dashboard uses read APIs only — it never executes nanopayments. The agent
 * purchase path (`POST /api/v1/agent/telemetry/latest` + Circle settle) lives
 * outside this gateway.
 */
export type TelemetryGateway = {
  /**
   * Load the latest delivered/stored telemetry for a wallet + device via the
   * dashboard read API. Returns `telemetry_available` or `no_new_record`.
   * Never returns `payment_required` (payments are agent-only).
   */
  getLatestTelemetry(
    walletId: WalletId,
    deviceId: DeviceId,
    signal?: AbortSignal,
  ): Promise<TelemetryRequestResult>;
};

const deviceTelemetryReadSchema = z.object({
  device: z.object({
    id: z.string().min(1),
    walletId: z.string().min(1),
  }),
  latestTelemetry: z
    .object({
      recordId: telemetryRecordIdSchema,
      recordedAt: z.string().min(1),
      contentHash: contentHashSchema,
      anchorStatus: z.string(),
      anchorTransactionHash: z.string().nullable(),
      data: z.unknown(),
    })
    .nullable(),
  verification: z
    .object({
      status: z.string(),
      paymentTransactionHash: z.string().nullable().optional(),
    })
    .nullable(),
});

/**
 * HTTP gateway backed by `GET /api/v1/devices/:deviceId/telemetry`.
 * Requires an API client configured with `X-Api-Key` when calling protected routes.
 */
export function createHttpTelemetryGateway(
  client: ApiClient = new ApiClient(),
): TelemetryGateway {
  return {
    async getLatestTelemetry(walletId, deviceId, signal) {
      const result = await client.request(
        `/api/v1/devices/${deviceId}/telemetry`,
        {
          method: 'GET',
          ...(signal !== undefined ? { signal } : {}),
          schema: deviceTelemetryReadSchema,
        },
      );

      if (!result.ok) {
        throw result.error;
      }

      const body = result.data;
      if (body.device.walletId !== walletId) {
        throw new Error('Device does not belong to the requested wallet');
      }

      if (body.latestTelemetry === null) {
        return parseTelemetryRequestResult({
          status: 'no_new_record',
          checkedAt: new Date().toISOString(),
        });
      }

      const anchorRef =
        body.latestTelemetry.anchorTransactionHash ??
        `pending:${body.latestTelemetry.recordId}`;

      return parseTelemetryRequestResult({
        status: 'telemetry_available',
        telemetry: {
          id: body.latestTelemetry.recordId,
          walletId,
          deviceId,
          recordedAt: body.latestTelemetry.recordedAt,
          contentHash: body.latestTelemetry.contentHash,
        },
        provenance: {
          anchorTransactionRef: anchorRef,
          contentHash: body.latestTelemetry.contentHash,
          anchoredAt: body.latestTelemetry.recordedAt,
        },
      });
    },
  };
}

/**
 * Placeholder gateway. Throws on use so it can never be mistaken for a working
 * integration or return fabricated telemetry.
 */
export const notImplementedTelemetryGateway: TelemetryGateway = {
  getLatestTelemetry(): Promise<TelemetryRequestResult> {
    return Promise.reject(
      new Error(
        'TelemetryGateway is not implemented. Use createHttpTelemetryGateway().',
      ),
    );
  },
};
