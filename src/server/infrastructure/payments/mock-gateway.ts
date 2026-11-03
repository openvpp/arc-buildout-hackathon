import { randomUUID } from 'node:crypto';

import type {
  GatewayBuyer,
  GatewaySeller,
  SettlementResult,
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

/** Accepts any well-formed payment and returns a fresh transfer id. */
export function createMockGatewaySeller(
  options: { result?: SettlementResult } = {},
): GatewaySeller {
  return {
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
  options: { address?: string; gatewayAvailableAtomic?: bigint } = {},
): GatewayBuyer {
  const address = options.address ?? MOCK_PAYER_ADDRESS;
  return {
    address,
    async getBalances() {
      return {
        walletAtomic: 0n,
        gatewayAvailableAtomic: options.gatewayAvailableAtomic ?? 10_000_000n,
      };
    },
    async deposit() {
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
