'use client';

import {
  useAuthTokenInfo,
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from '@web3auth/modal/react';
import { useCallback, useEffect, useState } from 'react';

import { resolveWalletAddressForOnboarding } from '@/lib/auth/web3auth-wallet-claims';

export type WalletSession =
  | {
      readonly status: 'unconfigured';
      readonly isReady: true;
      readonly address: null;
      readonly connect: null;
      readonly disconnect: null;
      readonly getIdToken: null;
    }
  | {
      readonly status: 'initializing' | 'disconnected' | 'connected';
      readonly isReady: boolean;
      readonly address: string | null;
      readonly isConnecting: boolean;
      readonly connectError: string | null;
      readonly connect: () => Promise<void>;
      readonly disconnect: () => Promise<void>;
      readonly getIdToken: () => Promise<string>;
    };

/**
 * Active only under Web3AuthProvider.
 * Callers must not use this when Web3Auth is unconfigured.
 *
 * Address source of truth: Web3Auth id-token `wallets` claim.
 */
export function useConfiguredWalletSession(): Exclude<
  WalletSession,
  { status: 'unconfigured' }
> {
  const { isInitialized } = useWeb3Auth();
  const {
    connect,
    isConnected,
    loading: isConnecting,
    error: connectError,
  } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const { getAuthTokenInfo } = useAuthTokenInfo();
  const [identityAddress, setIdentityAddress] = useState<string | null>(null);

  const getIdToken = useCallback(async () => {
    const token = await getAuthTokenInfo();
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Web3Auth identity token unavailable.');
    }
    return token;
  }, [getAuthTokenInfo]);

  useEffect(() => {
    if (!isInitialized || !isConnected) {
      return;
    }
    const cancelled = { current: false };
    void (async () => {
      try {
        const idToken = await getIdToken();
        const next = resolveWalletAddressForOnboarding({ idToken });
        if (!cancelled.current) {
          setIdentityAddress(next);
        }
      } catch {
        if (!cancelled.current) {
          setIdentityAddress(null);
        }
      }
    })();
    return () => {
      cancelled.current = true;
    };
  }, [isInitialized, isConnected, getIdToken]);

  const address = isConnected ? identityAddress : null;

  const status: 'initializing' | 'disconnected' | 'connected' = !isInitialized
    ? 'initializing'
    : isConnected && address !== null
      ? 'connected'
      : isConnected
        ? 'initializing'
        : 'disconnected';

  const connectWallet = useCallback(async () => {
    await connect();
  }, [connect]);

  const disconnectWallet = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  return {
    status,
    isReady: isInitialized,
    address,
    isConnecting,
    connectError: connectError?.message ?? null,
    connect: connectWallet,
    disconnect: disconnectWallet,
    getIdToken,
  };
}
