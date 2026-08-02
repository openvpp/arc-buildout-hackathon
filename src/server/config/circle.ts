/**
 * Circle Gateway / Arc payment constants derived from @circle-fin/x402-batching.
 */
export const ARC_TESTNET_CHAIN_ID = 5042002n;
export const ARC_TESTNET_CAIP2 = 'eip155:5042002' as const;
export const ARC_TESTNET_USDC_ADDRESS =
  '0x3600000000000000000000000000000000000000' as const;
export const ARC_TESTNET_GATEWAY_WALLET =
  '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;
export const CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL =
  'https://gateway-api-testnet.circle.com' as const;
export const GATEWAY_BATCHING_EXTRA_NAME = 'GatewayWalletBatched' as const;
export const GATEWAY_BATCHING_EXTRA_VERSION = '1' as const;
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED' as const;
export const PAYMENT_SIGNATURE_HEADER = 'payment-signature' as const;
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE' as const;
