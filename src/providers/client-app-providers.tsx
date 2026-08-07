'use client';

import { Web3AuthProvider, useWeb3Auth } from '@web3auth/modal/react';
import { WagmiProvider } from '@web3auth/modal/react/wagmi';
import type { ReactNode } from 'react';

import {
  createWeb3AuthContextConfig,
  WagmiReadyProvider,
} from '@/features/auth';
import { ThemeProvider } from '@/features/theme';
import { QueryProvider } from '@/providers/query-provider';

/**
 * Mount Wagmi only after Web3Auth init + EIP-155 chains exist.
 * Avoids createConfig(chains: undefined) → TypeError reading '[0]'.
 * Exposes WagmiReady so callers skip useAccount until the provider exists
 * (SSR / pre-init would otherwise throw WagmiProviderNotFoundError).
 */
function WagmiWhenReady({ children }: { children: ReactNode }) {
  const { isInitialized, web3Auth } = useWeb3Auth();
  if (!isInitialized || web3Auth === null) {
    return <WagmiReadyProvider ready={false}>{children}</WagmiReadyProvider>;
  }
  const chains = web3Auth.coreOptions.chains;
  const chainCount = Array.isArray(chains) ? chains.length : 0;
  if (chainCount === 0) {
    return <WagmiReadyProvider ready={false}>{children}</WagmiReadyProvider>;
  }
  return (
    <WagmiReadyProvider ready={true}>
      <WagmiProvider>{children}</WagmiProvider>
    </WagmiReadyProvider>
  );
}

/**
 * Client composition: Theme → Web3Auth (when configured) → React Query → Wagmi.
 * When Client ID is unset, skip Web3Auth so CI/builds still run.
 */
export function ClientAppProviders({ children }: { children: ReactNode }) {
  const config = createWeb3AuthContextConfig();

  if (config === null) {
    return (
      <ThemeProvider>
        <QueryProvider>{children}</QueryProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <Web3AuthProvider config={config}>
        <QueryProvider>
          <WagmiWhenReady>{children}</WagmiWhenReady>
        </QueryProvider>
      </Web3AuthProvider>
    </ThemeProvider>
  );
}
