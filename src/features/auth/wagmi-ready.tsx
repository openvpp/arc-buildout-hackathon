'use client';

import { createContext, useContext, type ReactNode } from 'react';

const WagmiReadyContext = createContext(false);

/** Set by ClientAppProviders when WagmiProvider is actually mounted. */
export function WagmiReadyProvider(props: {
  readonly ready: boolean;
  readonly children: ReactNode;
}) {
  return (
    <WagmiReadyContext.Provider value={props.ready}>
      {props.children}
    </WagmiReadyContext.Provider>
  );
}

export function useIsWagmiReady(): boolean {
  return useContext(WagmiReadyContext);
}

/**
 * Mount children only under WagmiProvider.
 * Required because Wagmi mounts after Web3Auth init; SSR always sees
 * "not ready" and must not call useAccount / useConfig.
 */
export function RequireWagmi(props: {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const ready = useIsWagmiReady();
  if (!ready) {
    return <>{props.fallback ?? null}</>;
  }
  return <>{props.children}</>;
}
