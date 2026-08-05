import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from '@web3auth/modal';
import type { Web3AuthContextConfig } from '@web3auth/modal/react';

import { env } from '@/config/env';

/** Arc testnet (eip155:5042002). Required so WagmiProvider can build chains. */
const ARC_TESTNET_CHAIN_ID_HEX = '0x4cf352';

export function isWeb3AuthConfigured(): boolean {
  return env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID.trim().length > 0;
}

export function resolveWeb3AuthNetwork():
  | (typeof WEB3AUTH_NETWORK)['SAPPHIRE_DEVNET']
  | (typeof WEB3AUTH_NETWORK)['SAPPHIRE_MAINNET'] {
  return env.NEXT_PUBLIC_WEB3AUTH_NETWORK === 'sapphire_mainnet'
    ? WEB3AUTH_NETWORK.SAPPHIRE_MAINNET
    : WEB3AUTH_NETWORK.SAPPHIRE_DEVNET;
}

export function createWeb3AuthContextConfig(): Web3AuthContextConfig | null {
  const clientId = env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID.trim();
  if (clientId.length === 0) {
    return null;
  }
  return {
    web3AuthOptions: {
      clientId,
      web3AuthNetwork: resolveWeb3AuthNetwork(),
      // WagmiProvider crashes with chains: undefined → createConfig reading [0]
      // when Web3Auth is initialized without an EIP-155 chain list.
      chains: [
        {
          chainNamespace: CHAIN_NAMESPACES.EIP155,
          chainId: ARC_TESTNET_CHAIN_ID_HEX,
          rpcTarget: 'https://rpc.testnet.arc.network',
          displayName: 'Arc Testnet',
          blockExplorerUrl: env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL,
          ticker: 'ETH',
          tickerName: 'Ether',
          decimals: 18,
          logo: 'https://images.web3auth.io/network-ethereum.svg',
        },
      ],
    },
  };
}
