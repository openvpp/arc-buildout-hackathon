import { z } from 'zod';

import {
  toContentHash,
  toDeviceId,
  toTelemetryRecordId,
  toTransactionRef,
  toWalletId,
} from '@/types/branded';

/**
 * PROVISIONAL Zod schemas for the telemetry request boundary.
 *
 * These validate untrusted backend responses before any value reaches UI code,
 * and construct branded identifiers at this trusted boundary. Field names are
 * provisional and will be reconciled with the real backend contract in Phase 2.
 */

const isoTimestamp = z.string().min(1);

export const walletIdSchema = z.string().min(1).transform(toWalletId);
export const deviceIdSchema = z.string().min(1).transform(toDeviceId);
export const telemetryRecordIdSchema = z
  .string()
  .min(1)
  .transform(toTelemetryRecordId);
export const transactionRefSchema = z
  .string()
  .min(1)
  .transform(toTransactionRef);
export const contentHashSchema = z.string().min(1).transform(toContentHash);

export const telemetryRecordSchema = z.object({
  id: telemetryRecordIdSchema,
  walletId: walletIdSchema,
  deviceId: deviceIdSchema,
  recordedAt: isoTimestamp,
  contentHash: contentHashSchema,
});

export const paymentRequirementSchema = z.object({
  requestId: z.string().min(1),
  amount: z.string().min(1),
  currency: z.literal('USDC'),
  sellerAddress: z.string().min(1),
  chain: z.string().min(1),
  expiresAt: isoTimestamp,
});

export const provenanceReferenceSchema = z.object({
  anchorTransactionRef: transactionRefSchema,
  contentHash: contentHashSchema,
  anchoredAt: isoTimestamp,
});

/**
 * The result of "request the latest telemetry". A discriminated union so every
 * expected outcome — including `no_new_record` and the `402`-driven
 * `payment_required` — is handled explicitly and none can be confused.
 */
export const telemetryRequestResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('payment_required'),
    payment: paymentRequirementSchema,
  }),
  z.object({
    status: z.literal('no_new_record'),
    checkedAt: isoTimestamp,
  }),
  z.object({
    status: z.literal('telemetry_available'),
    telemetry: telemetryRecordSchema,
    provenance: provenanceReferenceSchema,
  }),
]);

export type TelemetryRequestResult = z.infer<
  typeof telemetryRequestResultSchema
>;

/** Parse + validate an untrusted value. Throws `ZodError` on invalid input. */
export function parseTelemetryRequestResult(
  input: unknown,
): TelemetryRequestResult {
  return telemetryRequestResultSchema.parse(input);
}

/** Non-throwing narrowing helper for the payment-required outcome. */
export function isPaymentRequiredResult(
  result: TelemetryRequestResult,
): result is Extract<TelemetryRequestResult, { status: 'payment_required' }> {
  return result.status === 'payment_required';
}
