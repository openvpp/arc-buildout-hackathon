'use client';

import { Web3AuthProvider } from '@web3auth/modal/react';
import type { ReactNode } from 'react';

import { createWeb3AuthContextConfig } from '@/features/auth';
import { ThemeProvider } from '@/features/theme';
import { QueryProvider } from '@/providers/query-provider';

/**
 * Client composition: Theme → Web3Auth (when configured) → React Query.
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
        <QueryProvider>{children}</QueryProvider>
      </Web3AuthProvider>
    </ThemeProvider>
  );
}
