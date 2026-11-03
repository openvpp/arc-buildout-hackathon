import { GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS } from '@circle-fin/x402-batching/server';
import { z } from 'zod';

import type { ArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';

/**
 * x402 v2 payment requirements for Circle Gateway batched nanopayments
 * (scheme `exact`, Gateway wallet as the EIP-712 verifying contract).
 * Pure: building, encoding and decoding the two x402 headers.
 */

export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const X402_VERSION = 2;

const GATEWAY_BATCHING = { name: 'GatewayWalletBatched', version: '1' };

export type PaymentRequirements = {
  scheme: 'exact';
  network: string;
  asset: string;
  /** Atomic USDC units, as a decimal string. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string; verifyingContract: string };
};

export type PaymentRequiredBody = {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentRequirements[];
};

export function buildPaymentRequired(input: {
  network: ArcPaymentNetwork;
  payTo: string;
  amountAtomic: bigint;
  resourceUrl: string;
  description: string;
}): PaymentRequiredBody {
  return {
    x402Version: X402_VERSION,
    resource: {
      url: input.resourceUrl,
      description: input.description,
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: input.network.caip2,
        asset: input.network.usdcAddress,
        amount: input.amountAtomic.toString(),
        payTo: input.payTo,
        // Gateway rejects authorizations valid for less than this window.
        maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
        extra: {
          ...GATEWAY_BATCHING,
          verifyingContract: input.network.gatewayWalletAddress,
        },
      },
    ],
  };
}

function toBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function fromBase64Json(header: string): unknown {
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function encodePaymentRequiredHeader(body: PaymentRequiredBody): string {
  return toBase64Json(body);
}

const requirementsSchema = z.object({
  scheme: z.literal('exact'),
  network: z.string(),
  asset: z.string(),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string(),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.object({
    name: z.string(),
    version: z.string(),
    verifyingContract: z.string(),
  }),
});

const paymentRequiredSchema = z.object({
  x402Version: z.number().int(),
  resource: z.object({
    url: z.string(),
    description: z.string(),
    mimeType: z.string(),
  }),
  accepts: z.array(requirementsSchema).min(1),
});

/** Decodes a PAYMENT-REQUIRED header; null when it is not valid x402. */
export function decodePaymentRequiredHeader(
  header: string,
): PaymentRequiredBody | null {
  const parsed = paymentRequiredSchema.safeParse(fromBase64Json(header));
  return parsed.success ? parsed.data : null;
}

/** The Gateway batching option in a 402 body, if it offers one. */
export function findGatewayRequirements(
  body: PaymentRequiredBody,
): PaymentRequirements | null {
  return (
    body.accepts.find(
      (option) =>
        option.extra.name === GATEWAY_BATCHING.name &&
        option.extra.version === GATEWAY_BATCHING.version,
    ) ?? null
  );
}

/** What a payer sends back: the signed payload plus what it accepted. */
export type PaymentSignature = {
  x402Version: number;
  payload: Record<string, unknown>;
  resource?: PaymentRequiredBody['resource'];
  accepted?: Record<string, unknown>;
};

const paymentSignatureSchema = z
  .object({
    x402Version: z.number().int(),
    payload: z.record(z.unknown()),
    resource: paymentRequiredSchema.shape.resource.optional(),
    accepted: z.record(z.unknown()).optional(),
  })
  .passthrough();

export function encodePaymentSignatureHeader(value: PaymentSignature): string {
  return toBase64Json(value);
}

/**
 * The address that signed the payment's EIP-3009 authorization (lowercase),
 * known before settling. Null when the payload carries none.
 */
export function signerOfPaymentSignature(
  signature: PaymentSignature,
): string | null {
  const authorization = signature.payload['authorization'];
  if (typeof authorization !== 'object' || authorization === null) {
    return null;
  }
  const from = (authorization as Record<string, unknown>)['from'];
  return typeof from === 'string' && /^0x[0-9a-fA-F]{40}$/.test(from)
    ? from.toLowerCase()
    : null;
}

/** Decodes a PAYMENT-SIGNATURE header; null when it is not a payment. */
export function decodePaymentSignatureHeader(
  header: string,
): PaymentSignature | null {
  const parsed = paymentSignatureSchema.safeParse(fromBase64Json(header));
  return parsed.success ? parsed.data : null;
}
