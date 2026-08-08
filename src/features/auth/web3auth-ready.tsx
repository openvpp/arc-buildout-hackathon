'use client';

import { useWeb3Auth } from '@web3auth/modal/react';
import type { ReactNode } from 'react';

/**
 * Mount children only after Web3Auth has initialized.
 * Callers must already be under Web3AuthProvider (and typically gate on
 * isWeb3AuthConfigured() first).
 */
export function RequireWeb3Auth(props: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const { isInitialized } = useWeb3Auth();
  if (!isInitialized) {
    return <>{props.fallback ?? null}</>;
  }
  return <>{props.children}</>;
}
