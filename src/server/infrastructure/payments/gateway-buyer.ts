import {
  BatchEvmScheme,
  GatewayClient,
} from '@circle-fin/x402-batching/client';
import { privateKeyToAccount } from 'viem/accounts';

import { formatUsdcAtomic } from '@/lib/payments/usdc';
import type { GatewayBuyer } from '@/server/infrastructure/payments/gateway';
import type { ArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';
import {
  encodePaymentSignatureHeader,
  findGatewayRequirements,
} from '@/server/infrastructure/payments/x402';

function normalizeKey(key: string): `0x${string}` {
  return (key.startsWith('0x') ? key : `0x${key}`) as `0x${string}`;
}

/**
 * A payer backed by a raw EOA key (Gateway requires an EOA): the static
 * demo payer, or an agent's own key. `rpcUrl` must be a live Arc RPC — the
 * SDK's built-in default for Arc testnet no longer resolves.
 */
export function createGatewayBuyer(input: {
  network: ArcPaymentNetwork;
  privateKey: string;
  rpcUrl: string;
}): GatewayBuyer {
  const privateKey = normalizeKey(input.privateKey);
  const account = privateKeyToAccount(privateKey);
  const scheme = new BatchEvmScheme(account);
  const client = new GatewayClient({
    chain: input.network.gatewayChain,
    privateKey,
    rpcUrl: input.rpcUrl,
  });

  return {
    address: account.address.toLowerCase(),

    async getBalances(address) {
      const balances = await client.getBalances(
        address === undefined ? undefined : (address as `0x${string}`),
      );
      return {
        walletAtomic: balances.wallet.balance,
        gatewayAvailableAtomic: balances.gateway.available,
      };
    },

    async deposit(amountAtomic) {
      const result = await client.deposit(formatUsdcAtomic(amountAtomic));
      return { depositTxHash: result.depositTxHash };
    },

    async createPaymentSignatureHeader(body) {
      const requirements = findGatewayRequirements(body);
      if (requirements === null) {
        throw new Error('The 402 response offers no Circle Gateway option.');
      }
      const signed = await scheme.createPaymentPayload(
        body.x402Version,
        requirements,
      );
      return encodePaymentSignatureHeader({
        x402Version: signed.x402Version,
        // A plain JSON object; spread so it fits the header's record type.
        payload: { ...signed.payload },
        resource: body.resource,
        accepted: requirements,
      });
    },
  };
}
