'use client';

import {
  useAuthTokenInfo,
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from '@web3auth/modal/react';
import { useCallback } from 'react';
import { useAccount } from 'wagmi';

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
 * Active only under Web3AuthProvider + WagmiProvider.
 * Callers must not use this when Web3Auth is unconfigured.
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
  const { address } = useAccount();

  const normalizedAddress =
    typeof address === 'string' && address.length > 0
      ? address.toLowerCase()
      : null;

  const status: 'initializing' | 'disconnected' | 'connected' = !isInitialized
    ? 'initializing'
    : isConnected && normalizedAddress !== null
      ? 'connected'
      : 'disconnected';

  const getIdToken = useCallback(async () => {
    const token = await getAuthTokenInfo();
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error('Web3Auth identity token unavailable.');
    }
    return token;
  }, [getAuthTokenInfo]);

  const connectWallet = useCallback(async () => {
    await connect();
  }, [connect]);

  const disconnectWallet = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  return {
    status,
    isReady: isInitialized,
    address: normalizedAddress,
    isConnecting,
    connectError: connectError?.message ?? null,
    connect: connectWallet,
    disconnect: disconnectWallet,
    getIdToken,
  };
}
