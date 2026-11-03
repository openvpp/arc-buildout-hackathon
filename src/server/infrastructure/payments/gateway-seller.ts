import { BatchFacilitatorClient } from '@circle-fin/x402-batching/server';

import type {
  GatewaySeller,
  SettlementResult,
} from '@/server/infrastructure/payments/gateway';
import type { ArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';
import { decodePaymentSignatureHeader } from '@/server/infrastructure/payments/x402';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'gateway-seller' });

/** The part of Circle's facilitator client the seller uses (injectable). */
export type FacilitatorPort = Pick<BatchFacilitatorClient, 'settle'>;

/**
 * Settles x402 payments through Circle Gateway. `settle` both verifies the
 * signed authorization and locks the payer's Gateway funds, crediting the
 * seller; Gateway then settles many such payments in one batch on Arc.
 * Circle recommends calling settle directly rather than verify + settle.
 */
export function createGatewaySeller(input: {
  network: ArcPaymentNetwork;
  facilitator?: FacilitatorPort;
}): GatewaySeller {
  const facilitator =
    input.facilitator ??
    new BatchFacilitatorClient({ url: input.network.facilitatorUrl });

  return {
    async settle({ paymentSignatureHeader, requirements }) {
      const signature = decodePaymentSignatureHeader(paymentSignatureHeader);
      if (signature === null) {
        return {
          success: false,
          code: 'invalid',
          reason: 'The PAYMENT-SIGNATURE header is not an x402 payment.',
        };
      }
      let response: Awaited<ReturnType<FacilitatorPort['settle']>>;
      try {
        response = await facilitator.settle(signature, requirements);
      } catch (error) {
        // Never log the signature itself.
        log.warn('gateway.settle_unavailable', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          code: 'unavailable',
          reason: 'Circle Gateway could not be reached. Try again shortly.',
        };
      }
      return toSettlementResult(
        response,
        requirements.network,
        signerOf(signature.payload),
      );
    },
  };
}

/** The signing address inside an EIP-3009 authorization, if present. */
function signerOf(payload: Record<string, unknown>): string | null {
  const authorization = payload['authorization'];
  if (typeof authorization !== 'object' || authorization === null) {
    return null;
  }
  const from = (authorization as Record<string, unknown>)['from'];
  return typeof from === 'string' && from.length > 0 ? from : null;
}

function toSettlementResult(
  response: Awaited<ReturnType<FacilitatorPort['settle']>>,
  network: string,
  signer: string | null,
): SettlementResult {
  if (!response.success) {
    log.info('gateway.settle_refused', {
      errorReason: response.errorReason ?? 'unknown',
    });
    return {
      success: false,
      code: 'invalid',
      reason: response.errorReason ?? 'Circle Gateway refused the payment.',
    };
  }
  const reference = response.transaction.trim();
  // Gateway took the payment: the payer must not lose it to a missing
  // field. The payer is the signer of the authorization it accepted.
  const payer = response.payer ?? signer;
  if (reference.length === 0 || payer === null) {
    log.error('gateway.settle_incomplete', {
      hasReference: reference.length > 0,
      hasPayer: payer !== null,
    });
    return {
      success: false,
      code: 'unavailable',
      reason: 'Circle Gateway accepted the payment without a reference.',
    };
  }
  return {
    success: true,
    reference,
    payer: payer.toLowerCase(),
    network: response.network.length > 0 ? response.network : network,
  };
}
