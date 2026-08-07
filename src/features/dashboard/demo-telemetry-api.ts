import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';

const paymentRequiredSchema = z.object({
  status: z.literal('PAYMENT_REQUIRED'),
  paymentProtocolVersion: z.string(),
  paymentRequirement: z.object({
    id: z.string(),
    amountAtomic: z.string(),
    amountDisplay: z.string(),
    asset: z.string(),
    recipientAddress: z.string(),
    expiresAt: z.string(),
  }),
  telemetryReference: z.object({
    deviceId: z.string(),
    recordedAt: z.string(),
  }),
  demoNote: z.string().optional(),
});

const deliveredSchema = z.object({
  status: z.literal('TELEMETRY_DELIVERED'),
  deliveryId: z.string(),
  telemetry: z.object({
    recordId: z.string(),
    deviceId: z.string(),
    recordedAt: z.string(),
    data: z.record(z.string(), z.unknown()),
  }),
  payment: z.object({
    transactionHash: z.string(),
    verifiedAt: z.string(),
  }),
  provenance: z.object({
    status: z.string(),
    contentHash: z.string(),
  }),
  demoNote: z.string().optional(),
});

const idleSchema = z.object({
  status: z.enum(['NO_TELEMETRY_AVAILABLE', 'NO_NEW_RECORD']),
  deviceId: z.string(),
  checkedAt: z.string(),
  latestDeliveredTelemetryRecordId: z.string().optional(),
});

const responseSchema = z.union([
  paymentRequiredSchema,
  deliveredSchema,
  idleSchema,
]);

const verifyResultSchema = z.object({
  status: z.enum([
    'VERIFIED',
    'TX_MISSING',
    'TX_FAILED',
    'HASH_MISMATCH',
    'ERROR',
  ]),
  verificationId: z.string().uuid(),
  receiptFound: z.boolean(),
  receiptSuccess: z.boolean(),
  contentHashMatched: z.boolean(),
  contentHashExpected: z.string(),
  contentHashComputed: z.string(),
});

export type DemoTelemetryResponse = z.infer<typeof responseSchema>;
export type DemoVerifyResponse = z.infer<typeof verifyResultSchema>;

/**
 * Dashboard purchase + verify client. BFF settles with server Circle buyer (or
 * mock). Verify runs independent Arc + content-hash evidence.
 * Requires Web3Auth id token for device-owner auth.
 */
export function createDemoTelemetryApi(client: ApiClient = new ApiClient()) {
  return {
    async quote(input: {
      idToken: string;
      walletAddress: string;
      deviceId: string;
    }) {
      return request(client, { ...input, action: 'quote' });
    },
    async settle(input: {
      idToken: string;
      walletAddress: string;
      deviceId: string;
    }) {
      return request(client, { ...input, action: 'settle' });
    },
    async verify(input: {
      idToken: string;
      walletAddress: string;
      deviceId: string;
      telemetryRecordId: string;
      paymentTransactionHash: string;
    }): Promise<DemoVerifyResponse> {
      const result = await client.request('/api/v1/demo/telemetry/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.idToken}` },
        body: {
          walletAddress: input.walletAddress,
          deviceId: input.deviceId,
          telemetryRecordId: input.telemetryRecordId,
          paymentTransactionHash: input.paymentTransactionHash,
        },
        timeoutMs: 45_000,
        schema: verifyResultSchema,
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.data;
    },
  };
}

async function request(
  client: ApiClient,
  input: {
    idToken: string;
    walletAddress: string;
    deviceId: string;
    action: 'quote' | 'settle';
  },
): Promise<DemoTelemetryResponse> {
  const result = await client.request('/api/v1/demo/telemetry/latest', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.idToken}` },
    body: {
      walletAddress: input.walletAddress,
      deviceId: input.deviceId,
      action: input.action,
    },
    // Live Circle settle can exceed the default 15s client timeout.
    timeoutMs: input.action === 'settle' ? 60_000 : 30_000,
    schema: responseSchema,
  });
  if (!result.ok) {
    throw result.error;
  }
  return result.data;
}
