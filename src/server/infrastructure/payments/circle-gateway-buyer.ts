import {
  BatchEvmScheme,
  GatewayClient,
} from '@circle-fin/x402-batching/client';
import { privateKeyToAccount } from 'viem/accounts';

import { getServerEnv } from '@/server/config/env';
import type {
  CircleGatewayBuyer,
  CirclePaymentRequirements,
} from '@/server/domain/payments/circle-gateway';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'circle-gateway-buyer' });

function toUsdcNumber(atomic: string): number {
  return Number(atomic) / 1_000_000;
}

/**
 * Demo agent buyer. Requires ARC_PAYMENT_SIGNER_PRIVATE_KEY in non-production
 * demo/dev/test. Production must not load a raw private key from env.
 */
export function createCircleGatewayBuyer(): CircleGatewayBuyer {
  const env = getServerEnv();

  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
    throw new Error(
      'Circle Gateway buyer with env private key is forbidden in production/staging',
    );
  }

  const privateKey = env.ARC_PAYMENT_SIGNER_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    throw new Error('ARC_PAYMENT_SIGNER_PRIVATE_KEY is required for the buyer');
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const scheme = new BatchEvmScheme(account);
  const client = new GatewayClient({
    chain: 'arcTestnet',
    privateKey: privateKey as `0x${string}`,
    ...(env.ARC_RPC_URL !== undefined && env.ARC_RPC_URL.length > 0
      ? { rpcUrl: env.ARC_RPC_URL }
      : {}),
  });

  return {
    async ensureLiquidity(requiredAmountUsdc) {
      const balances = await client.getBalances();
      const available = Number(balances.gateway.formattedAvailable);

      if (available >= requiredAmountUsdc) {
        return { deposited: false, depositTxHash: null };
      }

      const autoDeposit = Math.max(
        Number(env.ARC_GATEWAY_AUTO_DEPOSIT_AMOUNT ?? requiredAmountUsdc),
        requiredAmountUsdc,
      );

      log.info('circle.buyer_deposit', { autoDeposit });
      const depositResult = await client.deposit(autoDeposit.toFixed(6));

      return {
        deposited: true,
        depositTxHash: depositResult.depositTxHash,
      };
    },

    async createPaymentSignature({ x402Version, requirements, resource }) {
      const paymentPayload = await scheme.createPaymentPayload(
        x402Version,
        requirements,
      );

      return Buffer.from(
        JSON.stringify({
          ...paymentPayload,
          resource,
          accepted: requirements,
        }),
        'utf8',
      ).toString('base64');
    },
  };
}

export function createMockCircleGatewayBuyer(): CircleGatewayBuyer {
  if (!getServerEnv().ALLOW_MOCK_ADAPTERS) {
    throw new Error(
      'Mock Circle buyer is forbidden unless ALLOW_MOCK_ADAPTERS=true',
    );
  }

  return {
    async ensureLiquidity() {
      return { deposited: false, depositTxHash: null };
    },
    async createPaymentSignature({ requirements, resource }) {
      return Buffer.from(
        JSON.stringify({
          mock: true,
          accepted: requirements,
          resource,
          amountUsdc: toUsdcNumber(requirements.amount),
        }),
        'utf8',
      ).toString('base64');
    },
  };
}

export type { CirclePaymentRequirements };
