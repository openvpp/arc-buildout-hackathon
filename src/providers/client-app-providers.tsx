'use client';

import { Web3AuthProvider } from '@web3auth/modal/react';
import { WagmiProvider } from '@web3auth/modal/react/wagmi';
import type { ReactNode } from 'react';

import { createWeb3AuthContextConfig } from '@/features/auth';
import { QueryProvider } from '@/providers/query-provider';

/**
 * Client composition: Web3Auth (when configured) → React Query → Wagmi.
 * When Client ID is unset, skip Web3Auth so CI/builds still run.
 */
export function ClientAppProviders({ children }: { children: ReactNode }) {
  const config = createWeb3AuthContextConfig();

  if (config === null) {
    return <QueryProvider>{children}</QueryProvider>;
  }

  return (
    <Web3AuthProvider config={config}>
      <QueryProvider>
        <WagmiProvider>{children}</WagmiProvider>
      </QueryProvider>
    </Web3AuthProvider>
  );
}
