import { randomUUID } from 'node:crypto';

import type {
  GatewayBuyer,
  GatewaySeller,
  SettlementResult,
  VerificationResult,
} from '@/server/infrastructure/payments/gateway';
import {
  decodePaymentSignatureHeader,
  encodePaymentSignatureHeader,
  findGatewayRequirements,
  signerOfPaymentSignature,
} from '@/server/infrastructure/payments/x402';

/**
 * Test and local-UI doubles: no Circle calls, no funds. Only selected when
 * ALLOW_MOCK_ADAPTERS=true, which staging and production refuse.
 */
export const MOCK_PAYER_ADDRESS = '0x00000000000000000000000000000000000000b0';

/**
 * Accepts a mock buyer's signature and returns a fresh transfer id.
 * `verify` accepts only that same shape (`payload.mock === true`); a header
 * that merely names an address does not pass.
 */
export function createMockGatewaySeller(
  options: { result?: SettlementResult } = {},
): GatewaySeller {
  return {
    async verify({ paymentSignatureHeader }): Promise<VerificationResult> {
      const signature = decodePaymentSignatureHeader(paymentSignatureHeader);
      if (signature === null || signature.payload['mock'] !== true) {
        return { ok: false, code: 'invalid', reason: 'Not a payment.' };
      }
      const payer = signerOfPaymentSignature(signature);
      if (payer === null) {
        return { ok: false, code: 'invalid', reason: 'Not a payment.' };
      }
      return { ok: true, payer };
    },

    async settle({ paymentSignatureHeader, requirements }) {
      if (options.result !== undefined) {
        return options.result;
      }
      const signature = decodePaymentSignatureHeader(paymentSignatureHeader);
      if (signature === null) {
        return { success: false, code: 'invalid', reason: 'Not a payment.' };
      }
      return {
        success: true,
        reference: randomUUID(),
        payer: signerOfPaymentSignature(signature) ?? MOCK_PAYER_ADDRESS,
        network: requirements.network,
      };
    },
  };
}

export function createMockGatewayBuyer(
  options: {
    address?: string;
    gatewayAvailableAtomic?: bigint;
    walletAtomic?: bigint;
  } = {},
): GatewayBuyer {
  const address = options.address ?? MOCK_PAYER_ADDRESS;
  const balances = {
    walletAtomic: options.walletAtomic ?? 0n,
    gatewayAvailableAtomic: options.gatewayAvailableAtomic ?? 10_000_000n,
  };
  return {
    address,
    async getBalances() {
      return { ...balances };
    },
    async deposit(amountAtomic) {
      if (amountAtomic > balances.walletAtomic) {
        throw new Error('Insufficient USDC balance.');
      }
      balances.walletAtomic -= amountAtomic;
      balances.gatewayAvailableAtomic += amountAtomic;
      return { depositTxHash: `0x${'0'.repeat(64)}` };
    },
    async createPaymentSignatureHeader(body) {
      const requirements = findGatewayRequirements(body);
      if (requirements === null) {
        throw new Error('The 402 response offers no Circle Gateway option.');
      }
      return encodePaymentSignatureHeader({
        x402Version: body.x402Version,
        payload: {
          mock: true,
          authorization: { from: address, nonce: randomUUID() },
        },
        resource: body.resource,
        accepted: requirements,
      });
    },
  };
}
