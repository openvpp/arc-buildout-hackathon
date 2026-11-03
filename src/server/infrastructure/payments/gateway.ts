import type {
  PaymentRequiredBody,
  PaymentRequirements,
} from '@/server/infrastructure/payments/x402';

/**
 * Ports for Circle Gateway nanopayments. Production adapters wrap the
 * Circle SDK (gateway-seller.ts, gateway-buyer.ts); tests inject the mocks
 * in mock-gateway.ts. Nothing here touches the database.
 */

export type SettlementResult =
  | {
      success: true;
      /**
       * Gateway's transfer id for this payment (a UUID). The on-chain batch
       * transaction comes later, once Gateway settles the batch.
       */
      reference: string;
      payer: string;
      network: string;
    }
  | {
      success: false;
      /** `invalid`: the payment was refused; `unavailable`: try again. */
      code: 'invalid' | 'unavailable';
      reason: string;
    };

/** Seller side: verify and settle a payer's signed authorization. */
export type GatewaySeller = {
  settle(input: {
    paymentSignatureHeader: string;
    requirements: PaymentRequirements;
  }): Promise<SettlementResult>;
};

export type GatewayBalances = {
  /** USDC held by the payer's own address on Arc (atomic units). */
  walletAtomic: bigint;
  /** USDC in Gateway available for payments (atomic units). */
  gatewayAvailableAtomic: bigint;
};

/** Buyer side: the static demo payer (or the agent's own key). */
export type GatewayBuyer = {
  address: string;
  getBalances(): Promise<GatewayBalances>;
  /** An on-chain deposit into Gateway. Callers confirm with a human first. */
  deposit(amountAtomic: bigint): Promise<{ depositTxHash: string }>;
  /** Signs a payment for the Gateway option of a 402 body. */
  createPaymentSignatureHeader(body: PaymentRequiredBody): Promise<string>;
};
