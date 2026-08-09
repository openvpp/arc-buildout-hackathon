'use client';

import { Web3AuthProvider } from '@web3auth/modal/react';
import type { ReactNode } from 'react';

import { createWeb3AuthContextConfig } from '@/features/auth';
import { ThemeProvider } from '@/features/theme';

/**
 * Client composition: Theme → Web3Auth (when configured).
 * When Client ID is unset, skip Web3Auth so CI/builds still run.
 */
export function ClientAppProviders({ children }: { children: ReactNode }) {
  const config = createWeb3AuthContextConfig();

  if (config === null) {
    return <ThemeProvider>{children}</ThemeProvider>;
  }

  return (
    <ThemeProvider>
      <Web3AuthProvider config={config}>{children}</Web3AuthProvider>
    </ThemeProvider>
  );
}
