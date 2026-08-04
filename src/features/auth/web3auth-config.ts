import { WEB3AUTH_NETWORK } from '@web3auth/modal';
import type { Web3AuthContextConfig } from '@web3auth/modal/react';

import { env } from '@/config/env';

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
    },
  };
}
