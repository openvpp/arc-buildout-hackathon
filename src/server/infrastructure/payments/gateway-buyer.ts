import {
  BatchEvmScheme,
  GatewayClient,
} from '@circle-fin/x402-batching/client';
import { parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { formatUsdcAtomic } from '@/lib/payments/usdc';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import type { GatewayBuyer } from '@/server/infrastructure/payments/gateway';
import type { ArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';
import {
  encodePaymentSignatureHeader,
  findGatewayRequirements,
} from '@/server/infrastructure/payments/x402';

const log = createServerLogger({ component: 'gateway-buyer' });

const gatewayBalanceAbi = parseAbi([
  'function availableBalance(address token, address depositor) view returns (uint256)',
]);

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
      const target = (address ?? account.address) as `0x${string}`;
      const [balances, onChainAvailable] = await Promise.all([
        client.getBalances(address === undefined ? undefined : target),
        onChainGatewayAvailable(client, target),
      ]);
      // The Gateway API can lag a deposit. The contract's availableBalance
      // is credited in the deposit transaction, so prefer it when it is higher.
      const apiAvailable = balances.gateway.available;
      return {
        walletAtomic: balances.wallet.balance,
        gatewayAvailableAtomic:
          onChainAvailable !== null && onChainAvailable > apiAvailable
            ? onChainAvailable
            : apiAvailable,
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

/** Spendable Gateway balance on this chain, or null when the RPC read fails. */
async function onChainGatewayAvailable(
  client: GatewayClient,
  depositor: `0x${string}`,
): Promise<bigint | null> {
  try {
    return await client.publicClient.readContract({
      address: client.chainConfig.gatewayWallet,
      abi: gatewayBalanceAbi,
      functionName: 'availableBalance',
      args: [client.chainConfig.usdc, depositor],
    });
  } catch (error) {
    log.warn('gateway.on_chain_balance_unavailable', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
