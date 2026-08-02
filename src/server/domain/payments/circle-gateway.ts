export type CirclePaymentRequirements = {
  readonly scheme: string;
  readonly network: string;
  readonly asset: string;
  readonly amount: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra: {
    readonly name: string;
    readonly version: string;
    readonly verifyingContract: string;
  };
};

export type CirclePaymentRequiredBody = {
  readonly x402Version: number;
  readonly resource: {
    readonly url: string;
    readonly description: string;
    readonly mimeType: string;
  };
  readonly accepts: readonly CirclePaymentRequirements[];
};

export type CircleSettlementResult =
  | {
      readonly success: true;
      readonly transactionHash: string;
      readonly payer: string;
      readonly network: string;
    }
  | {
      readonly success: false;
      readonly code: string;
      readonly message: string;
    };

/**
 * Seller-side Circle Gateway settler.
 * Production uses BatchFacilitatorClient; tests inject a double.
 */
export type CircleGatewaySeller = {
  buildPaymentRequired(input: {
    resourceUrl: string;
    description: string;
    amountAtomic: string;
    payTo: string;
    asset: string;
    network: string;
    verifyingContract: string;
    maxTimeoutSeconds: number;
  }): CirclePaymentRequiredBody;

  encodePaymentRequiredHeader(body: CirclePaymentRequiredBody): string;

  settle(input: {
    paymentSignatureHeader: string;
    requirements: CirclePaymentRequirements;
  }): Promise<CircleSettlementResult>;
};

/**
 * Buyer-side Circle Gateway client for the demo agent.
 */
export type CircleGatewayBuyer = {
  ensureLiquidity(requiredAmountUsdc: number): Promise<{
    deposited: boolean;
    depositTxHash: string | null;
  }>;
  createPaymentSignature(input: {
    x402Version: number;
    requirements: CirclePaymentRequirements;
    resource: CirclePaymentRequiredBody['resource'];
  }): Promise<string>;
};
