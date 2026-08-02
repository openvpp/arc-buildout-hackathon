import { getServerEnv } from '@/server/config/env';
import type {
  EnodeClient,
  PaymentVerifier,
  ProvenanceAnchor,
} from '@/server/domain/shared/ports';

/**
 * Fail-closed stubs for deferred integrations.
 *
 * Production/staging reject mock adapters via env validation. Development and
 * test may set ALLOW_MOCK_ADAPTERS=true, but these stubs still refuse to claim
 * successful verification — they only make the wiring compile and boot.
 */

export function createFailClosedPaymentVerifier(): PaymentVerifier {
  return {
    async verifyPayment() {
      if (!getServerEnv().ALLOW_MOCK_ADAPTERS) {
        return {
          status: 'failed',
          code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
          message:
            'Arc payment verifier is not configured. Refusing to confirm payment.',
        };
      }

      return {
        status: 'failed',
        code: 'PAYMENT_VERIFICATION_UNAVAILABLE',
        message:
          'Payment verifier adapter is not implemented. No payment can be confirmed.',
      };
    },
  };
}

export function createFailClosedProvenanceAnchor(): ProvenanceAnchor {
  return {
    async anchorTelemetry() {
      throw new Error(
        'ProvenanceAnchor adapter is not implemented. Anchoring is deferred.',
      );
    },
    async getAnchorStatus() {
      return { status: 'pending' };
    },
    async verifyAnchor() {
      return {
        valid: false,
        reason: 'ProvenanceAnchor adapter is not implemented.',
      };
    },
  };
}

export function createFailClosedEnodeClient(): EnodeClient {
  return {
    async getVehicle() {
      throw new Error('EnodeClient adapter is not implemented.');
    },
    async listVehicles() {
      throw new Error('EnodeClient adapter is not implemented.');
    },
  };
}
