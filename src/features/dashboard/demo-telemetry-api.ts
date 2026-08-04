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

export type DemoTelemetryResponse = z.infer<typeof responseSchema>;

/**
 * Mock-only dashboard purchase client (BFF keeps AGENT_API_KEY server-side).
 */
export function createDemoTelemetryApi(client: ApiClient = new ApiClient()) {
  return {
    async quote(input: { walletAddress: string; deviceId: string }) {
      return request(client, { ...input, action: 'quote' });
    },
    async settle(input: { walletAddress: string; deviceId: string }) {
      return request(client, { ...input, action: 'settle' });
    },
  };
}

async function request(
  client: ApiClient,
  input: {
    walletAddress: string;
    deviceId: string;
    action: 'quote' | 'settle';
  },
): Promise<DemoTelemetryResponse> {
  const result = await client.request('/api/v1/demo/telemetry/latest', {
    method: 'POST',
    body: input,
    schema: responseSchema,
  });
  if (!result.ok) {
    // 402 is expected for quote — ApiClient treats non-2xx as errors.
    // Retries via a loose parse of status/message are not available here;
    // use settle for pay. For quote we need the server to return 200 with
    // PAYMENT_REQUIRED in the body, or handle 402 specially.
    throw result.error;
  }
  return result.data;
}
