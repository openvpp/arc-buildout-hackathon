import { parseUsdcToAtomic } from '@/lib/payments/usdc';
import { getServerEnv, type ServerEnv } from '@/server/config/env';
import { resolveArcRpcUrl } from '@/server/infrastructure/blockchain/network-provider';
import {
  resolveArcPaymentNetwork,
  type ArcPaymentNetwork,
} from '@/server/infrastructure/payments/arc-payment-network';
import type {
  GatewayBuyer,
  GatewaySeller,
} from '@/server/infrastructure/payments/gateway';
import { createGatewayBuyer } from '@/server/infrastructure/payments/gateway-buyer';
import { createGatewaySeller } from '@/server/infrastructure/payments/gateway-seller';
import {
  createGatewayBalanceReader,
  createGatewayTransferLookup,
  type GatewayTransferLookup,
} from '@/server/infrastructure/payments/gateway-transfers';
import {
  createMockGatewayBuyer,
  createMockGatewaySeller,
} from '@/server/infrastructure/payments/mock-gateway';

export type PaymentConfig = {
  network: ArcPaymentNetwork;
  sellerAddress: string;
  unlockPriceAtomic: bigint;
  staticPayerDailyCapAtomic: bigint;
};

/** Why unlocks cannot be sold on this deployment, if they cannot. */
export type PaymentConfigResult =
  | { ok: true; config: PaymentConfig }
  | { ok: false; reason: 'unsupported_chain' | 'no_seller_address' };

export function resolvePaymentConfig(
  env: ServerEnv = getServerEnv(),
): PaymentConfigResult {
  const network = resolveArcPaymentNetwork(env);
  if (network === null) {
    return { ok: false, reason: 'unsupported_chain' };
  }
  if (env.SELLER_WALLET_ADDRESS === undefined) {
    return { ok: false, reason: 'no_seller_address' };
  }
  return {
    ok: true,
    config: {
      network,
      sellerAddress: env.SELLER_WALLET_ADDRESS.toLowerCase(),
      unlockPriceAtomic: parseUsdcToAtomic(env.EVENT_UNLOCK_PRICE_USDC),
      staticPayerDailyCapAtomic: parseUsdcToAtomic(
        env.STATIC_PAYER_DAILY_CAP_USDC,
      ),
    },
  };
}

/**
 * Gateway transfer lookup; with mock adapters, mock payments are unknown to
 * Gateway, so they simply stay "accepted" (no network calls).
 */
export function createConfiguredTransferLookup(
  network: ArcPaymentNetwork,
): GatewayTransferLookup {
  return getServerEnv().ALLOW_MOCK_ADAPTERS
    ? async () => null
    : createGatewayTransferLookup(network);
}

/** Gateway balance of any address (mock: a fixed demo amount, no network). */
export function createConfiguredBalanceReader(
  network: ArcPaymentNetwork,
): (address: string) => Promise<bigint> {
  return getServerEnv().ALLOW_MOCK_ADAPTERS
    ? async () => 10_000_000n
    : createGatewayBalanceReader(network);
}

/** Circle Gateway seller, or the mock when ALLOW_MOCK_ADAPTERS=true. */
export function createConfiguredSeller(
  network: ArcPaymentNetwork,
): GatewaySeller {
  return getServerEnv().ALLOW_MOCK_ADAPTERS
    ? createMockGatewaySeller()
    : createGatewaySeller({ network });
}

/**
 * The static demo payer, or null when none is configured. Uses the mock
 * when ALLOW_MOCK_ADAPTERS=true and no key is set. Never available when
 * APP_ENV=production (startup refuses the key there).
 */
export function createStaticPayer(
  network: ArcPaymentNetwork,
): GatewayBuyer | null {
  const env = getServerEnv();
  if (env.APP_ENV === 'production') {
    return null;
  }
  const key = env.ARC_PAYMENT_SIGNER_PRIVATE_KEY;
  if (key === undefined || key.length === 0) {
    return env.ALLOW_MOCK_ADAPTERS ? createMockGatewayBuyer() : null;
  }
  return createGatewayBuyer({
    network,
    privateKey: key,
    rpcUrl: resolveArcRpcUrl(env),
  });
}
