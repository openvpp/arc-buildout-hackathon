import { and, desc, eq } from 'drizzle-orm';

import type { AuthenticatedPrincipal } from '@/server/infrastructure/auth/api-keys';
import type { Database } from '@/server/infrastructure/db/client';
import {
  agentVerificationResults,
  devices,
  principalWallets,
  telemetryRecords,
} from '@/server/infrastructure/db/schema';
import { ApiError } from '@/server/transport/http/api-error';

export type DeviceTelemetrySnapshot = {
  readonly device: {
    readonly id: string;
    readonly walletId: string;
    readonly displayName: string | null;
    readonly vendor: string | null;
    readonly model: string | null;
    readonly status: string;
  };
  readonly latestTelemetry: {
    readonly recordId: string;
    readonly recordedAt: string;
    readonly contentHash: string;
    readonly anchorStatus: string;
    readonly anchorTransactionHash: string | null;
    readonly data: unknown;
  } | null;
  readonly verification: {
    readonly status: string;
    readonly source: 'agent_reported';
    readonly paymentTransactionHash: string;
    readonly contentHashMatched: boolean;
    readonly receiptSuccess: boolean;
    readonly verifiedAt: string;
  } | null;
};

export async function getDeviceTelemetrySnapshot(input: {
  db: Database;
  principal: AuthenticatedPrincipal;
  deviceId: string;
}): Promise<DeviceTelemetrySnapshot> {
  const [device] = await input.db
    .select()
    .from(devices)
    .where(eq(devices.id, input.deviceId))
    .limit(1);
  if (device === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Device not found.',
      status: 404,
    });
  }

  const [access] = await input.db
    .select()
    .from(principalWallets)
    .where(
      and(
        eq(principalWallets.principalId, input.principal.principalId),
        eq(principalWallets.walletId, device.walletId),
      ),
    )
    .limit(1);
  if (access === undefined) {
    throw new ApiError({
      code: 'RESOURCE_NOT_FOUND',
      message: 'Device not found.',
      status: 404,
    });
  }

  const [latest] = await input.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.deviceId, input.deviceId))
    .orderBy(desc(telemetryRecords.recordedAt), desc(telemetryRecords.id))
    .limit(1);

  let verification: DeviceTelemetrySnapshot['verification'] = null;
  if (latest !== undefined) {
    const [result] = await input.db
      .select()
      .from(agentVerificationResults)
      .where(eq(agentVerificationResults.telemetryRecordId, latest.id))
      .orderBy(desc(agentVerificationResults.verifiedAt))
      .limit(1);
    if (result !== undefined) {
      verification = {
        status: result.status,
        source: 'agent_reported',
        paymentTransactionHash: result.paymentTransactionHash,
        contentHashMatched: result.contentHashMatched,
        receiptSuccess: result.receiptSuccess,
        verifiedAt: result.verifiedAt.toISOString(),
      };
    }
  }

  return {
    device: {
      id: device.id,
      walletId: device.walletId,
      displayName: device.displayName,
      vendor: device.vendor,
      model: device.model,
      status: device.status,
    },
    latestTelemetry:
      latest === undefined
        ? null
        : {
            recordId: latest.id,
            recordedAt: latest.recordedAt.toISOString(),
            contentHash: latest.contentHash,
            anchorStatus: latest.anchorStatus,
            anchorTransactionHash: latest.anchorTransactionHash,
            data: latest.telemetryPayload,
          },
    verification,
  };
}
