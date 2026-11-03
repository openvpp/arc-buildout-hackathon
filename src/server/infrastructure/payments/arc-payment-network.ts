import {
  CHAIN_CONFIGS,
  type SupportedChainName,
} from '@circle-fin/x402-batching/client';

import { arcNetworkFor } from '@/config/arc-network';
import type { ServerEnv } from '@/server/config/env';

/** Gateway API used to verify and settle x402 payments, per network. */
const FACILITATOR_URLS = {
  testnet: 'https://gateway-api-testnet.circle.com',
  mainnet: 'https://gateway-api.circle.com',
} as const;

export type ArcPaymentNetwork = {
  /** Circle SDK chain name, e.g. `arcTestnet`. */
  gatewayChain: SupportedChainName;
  /** CAIP-2 network id used in x402 requirements, e.g. `eip155:5042002`. */
  caip2: `eip155:${number}`;
  chainId: bigint;
  usdcAddress: string;
  /** Gateway wallet contract: the EIP-712 verifying contract for payments. */
  gatewayWalletAddress: string;
  /** Circle's domain id for this chain (Gateway balance lookups). */
  gatewayDomain: number;
  facilitatorUrl: string;
  isTestnet: boolean;
};

/**
 * Payment network for the configured ARC_CHAIN_ID, from the Circle SDK's own
 * chain table (never hand-copied addresses). Null for a chain Gateway does
 * not support.
 */
export function resolveArcPaymentNetwork(
  env: Pick<ServerEnv, 'ARC_CHAIN_ID' | 'CIRCLE_GATEWAY_FACILITATOR_URL'>,
): ArcPaymentNetwork | null {
  const network = arcNetworkFor(env.ARC_CHAIN_ID);
  if (network === 'unknown') {
    return null;
  }
  const gatewayChain: SupportedChainName =
    network === 'mainnet' ? 'arc' : 'arcTestnet';
  const config = CHAIN_CONFIGS[gatewayChain];
  if (String(config.chain.id) !== env.ARC_CHAIN_ID) {
    return null;
  }
  return {
    gatewayChain,
    caip2: `eip155:${config.chain.id}`,
    chainId: BigInt(config.chain.id),
    usdcAddress: config.usdc,
    gatewayWalletAddress: config.gatewayWallet,
    gatewayDomain: config.domain,
    facilitatorUrl:
      env.CIRCLE_GATEWAY_FACILITATOR_URL ?? FACILITATOR_URLS[network],
    isTestnet: network === 'testnet',
  };
}
