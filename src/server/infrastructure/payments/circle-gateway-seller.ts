import {
  BatchFacilitatorClient,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from '@circle-fin/x402-batching/server';

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

function decodePaymentSignature(header: string): unknown {
  const json = Buffer.from(header, 'base64').toString('utf8');
  return JSON.parse(json) as unknown;
}

export function createCircleGatewaySeller(input?: {
  facilitator?: BatchFacilitatorClient;
}): CircleGatewaySeller {
  const env = getServerEnv();
  const facilitatorUrl =
    env.CIRCLE_GATEWAY_FACILITATOR_URL !== undefined &&
    env.CIRCLE_GATEWAY_FACILITATOR_URL.length > 0
      ? env.CIRCLE_GATEWAY_FACILITATOR_URL
      : CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL;

  const facilitator =
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
        // Circle docs: prefer settle() directly for production flows.
        const settleResult = await facilitator.settle(
          payload as never,
          requirements,
        );

        if (!settleResult.success) {
          log.warn('circle.settle_failed', {
            errorReason:
              'errorReason' in settleResult
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
          typeof settleResult.transaction === 'string'
            ? settleResult.transaction
            : '';
        if (!transactionHash.startsWith('0x')) {
          return {
            success: false,
            code: 'PAYMENT_SETTLEMENT_FAILED',
            message: 'Settlement succeeded without a transaction hash.',
          };
        }

        return {
          success: true,
          transactionHash: transactionHash.toLowerCase(),
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
