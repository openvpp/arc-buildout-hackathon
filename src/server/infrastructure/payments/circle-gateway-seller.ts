import {
  BatchFacilitatorClient,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '@circle-fin/x402-batching/server';
import { z } from 'zod';

import {
  ARC_TESTNET_CAIP2,
  ARC_TESTNET_GATEWAY_WALLET,
  ARC_TESTNET_USDC_ADDRESS,
  CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL,
  GATEWAY_BATCHING_EXTRA_NAME,
  GATEWAY_BATCHING_EXTRA_VERSION,
} from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import type {
  CircleGatewaySeller,
  CirclePaymentRequiredBody,
  CirclePaymentRequirements,
  CircleSettlementResult,
} from '@/server/domain/payments/circle-gateway';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'circle-gateway-seller' });

/**
 * Circle Gateway batch settle returns a transfer UUID in `transaction` on
 * success (on-chain txHash arrives later when the batch lands). Legacy /
 * mock doubles may still return a 0x hash. Accept either non-empty string.
 */
export function extractSettlementTransactionReference(settleResult: {
  readonly transaction?: unknown;
  readonly transactionHash?: unknown;
  readonly txHash?: unknown;
  readonly id?: unknown;
}): string | null {
  const candidates = [
    settleResult.transaction,
    settleResult.transactionHash,
    settleResult.txHash,
    settleResult.id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length === 0) {
      continue;
    }
    return trimmed.startsWith('0x') || trimmed.startsWith('0X')
      ? trimmed.toLowerCase()
      : trimmed;
  }
  return null;
}

/**
 * Narrow facilitator surface used by the seller so tests can inject doubles
 * without calling Circle.
 */
export type CircleFacilitatorPort = {
  settle(
    payload: unknown,
    requirements: CirclePaymentRequirements,
  ): Promise<{
    success: boolean;
    transaction?: string;
    transactionHash?: string;
    txHash?: string;
    id?: string;
    payer?: string;
    errorReason?: string;
  }>;
};

const paymentSignatureEnvelopeSchema = z
  .object({
    mock: z.boolean().optional(),
  })
  .passthrough();

function decodePaymentSignature(header: string): unknown {
  let json: string;
  try {
    json = Buffer.from(header, 'base64').toString('utf8');
  } catch {
    throw new Error('Payment signature is not valid base64');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error('Payment signature is not valid JSON');
  }
  const checked = paymentSignatureEnvelopeSchema.safeParse(parsed);
  if (!checked.success) {
    throw new Error('Payment signature payload shape is invalid');
  }
  return checked.data;
}

export function createCircleGatewaySeller(input?: {
  facilitator?: CircleFacilitatorPort;
}): CircleGatewaySeller {
  const env = getServerEnv();
  const facilitatorUrl =
    env.CIRCLE_GATEWAY_FACILITATOR_URL !== undefined &&
    env.CIRCLE_GATEWAY_FACILITATOR_URL.length > 0
      ? env.CIRCLE_GATEWAY_FACILITATOR_URL
      : CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL;

  const facilitator: CircleFacilitatorPort =
    input?.facilitator ??
    new BatchFacilitatorClient({
      url: facilitatorUrl,
      ...(env.CIRCLE_GATEWAY_AUTH_TOKEN !== undefined &&
      env.CIRCLE_GATEWAY_AUTH_TOKEN.length > 0
        ? {
            createAuthHeaders: async () => ({
              verify: {
                Authorization: `Bearer ${env.CIRCLE_GATEWAY_AUTH_TOKEN}`,
              },
              settle: {
                Authorization: `Bearer ${env.CIRCLE_GATEWAY_AUTH_TOKEN}`,
              },
              supported: {
                Authorization: `Bearer ${env.CIRCLE_GATEWAY_AUTH_TOKEN}`,
              },
            }),
          }
        : {}),
    });

  return {
    buildPaymentRequired({
      resourceUrl,
      description,
      amountAtomic,
      payTo,
      asset,
      network,
      verifyingContract,
      maxTimeoutSeconds,
    }) {
      const requirements: CirclePaymentRequirements = {
        scheme: 'exact',
        network,
        asset,
        amount: amountAtomic,
        payTo,
        maxTimeoutSeconds,
        extra: {
          name: GATEWAY_BATCHING_EXTRA_NAME,
          version: GATEWAY_BATCHING_EXTRA_VERSION,
          verifyingContract,
        },
      };

      return {
        x402Version: 2,
        resource: {
          url: resourceUrl,
          description,
          mimeType: 'application/json',
        },
        accepts: [requirements],
      };
    },

    encodePaymentRequiredHeader(body) {
      return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
    },

    async settle({ paymentSignatureHeader, requirements }) {
      try {
        const payload = decodePaymentSignature(paymentSignatureHeader);
        const settleResult = await facilitator.settle(payload, requirements);

        if (!settleResult.success) {
          log.warn('circle.settle_failed', {
            errorReason:
              settleResult.errorReason !== undefined
                ? String(settleResult.errorReason)
                : 'unknown',
          });
          return {
            success: false,
            code: 'PAYMENT_SETTLEMENT_FAILED',
            message: 'Circle Gateway settlement failed.',
          };
        }

        const transactionHash =
          extractSettlementTransactionReference(settleResult);
        if (transactionHash === null) {
          log.warn('circle.settle_missing_reference', {
            hasTransactionField: settleResult.transaction !== undefined,
          });
          return {
            success: false,
            code: 'PAYMENT_SETTLEMENT_FAILED',
            message: 'Settlement succeeded without a transaction reference.',
          };
        }

        log.info('circle.settle_ok', {
          referenceKind: transactionHash.startsWith('0x')
            ? 'onchain_tx'
            : 'gateway_transfer_id',
        });

        return {
          success: true,
          transactionHash,
          payer:
            typeof settleResult.payer === 'string' ? settleResult.payer : '',
          network: requirements.network,
        };
      } catch (error) {
        log.error('circle.settle_error', {
          errorMessage: error instanceof Error ? error.message : 'unknown',
        });
        return {
          success: false,
          code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
          message: 'Circle Gateway settlement is unavailable.',
        };
      }
    },
  };
}

export function createMockCircleGatewaySeller(input?: {
  settleResult?: CircleSettlementResult;
}): CircleGatewaySeller {
  if (!getServerEnv().ALLOW_MOCK_ADAPTERS) {
    throw new Error(
      'Mock Circle seller is forbidden unless ALLOW_MOCK_ADAPTERS=true',
    );
  }

  return {
    buildPaymentRequired(args) {
      return createCircleGatewaySeller().buildPaymentRequired(args);
    },
    encodePaymentRequiredHeader(body) {
      return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
    },
    async settle() {
      return (
        input?.settleResult ?? {
          success: true,
          transactionHash:
            '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          payer: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          network: ARC_TESTNET_CAIP2,
        }
      );
    },
  };
}

export function defaultArcPaymentRequirements(input: {
  amountAtomic: string;
  payTo: string;
}): CirclePaymentRequirements {
  const env = getServerEnv();
  return {
    scheme: 'exact',
    network: ARC_TESTNET_CAIP2,
    asset: env.ARC_USDC_CONTRACT_ADDRESS ?? ARC_TESTNET_USDC_ADDRESS,
    amount: input.amountAtomic,
    payTo: input.payTo,
    maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
    extra: {
      name: GATEWAY_BATCHING_EXTRA_NAME,
      version: GATEWAY_BATCHING_EXTRA_VERSION,
      verifyingContract:
        env.CIRCLE_GATEWAY_WALLET_ADDRESS ?? ARC_TESTNET_GATEWAY_WALLET,
    },
  };
}

export function parsePaymentRequiredHeader(
  header: string,
): CirclePaymentRequiredBody {
  const parsed = JSON.parse(
    Buffer.from(header, 'base64').toString('utf8'),
  ) as CirclePaymentRequiredBody;
  return parsed;
}

export function findGatewayBatchingOption(
  body: CirclePaymentRequiredBody,
): CirclePaymentRequirements | null {
  const match = body.accepts.find(
    (option) =>
      option.extra.name === GATEWAY_BATCHING_EXTRA_NAME &&
      option.extra.version === GATEWAY_BATCHING_EXTRA_VERSION,
  );
  return match ?? null;
}
