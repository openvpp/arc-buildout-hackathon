'use client';

import {
  useAuthTokenInfo,
  useWeb3Auth,
  useWeb3AuthConnect,
  useWeb3AuthDisconnect,
} from '@web3auth/modal/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

type ResolvedIdentity = {
  readonly address: string | null;
  readonly error: string | null;
};

function resolveIdentityFromIdToken(idToken: string): ResolvedIdentity {
  try {
    return {
      address: resolveWalletAddressForOnboarding({ idToken }),
      error: null,
    };
  } catch (error) {
    return {
      address: null,
      error:
        error instanceof Error ? error.message : 'Failed to resolve wallet.',
    };
  }
}

/**
 * Active only under Web3AuthProvider.
 * Callers must not use this when Web3Auth is unconfigured.
 *
 * Address source of truth: Web3Auth id-token `wallets` claim.
 *
 * Important: prefer the cached id-token from `useAuthTokenInfo`. Calling
 * `getAuthTokenInfo()` moves connector status to `authorizing`, which is NOT
 * treated as `isConnected` by the SDK — that would cancel an in-flight effect
 * and leave the topbar stuck on "Wallet…".
 */
export function useConfiguredWalletSession(): Exclude<
  WalletSession,
  { status: 'unconfigured' }
> {
  const { isInitialized, status: connectorStatus } = useWeb3Auth();
  const {
    connect,
    isConnected,
    loading: isConnecting,
    error: connectError,
  } = useWeb3AuthConnect();
  const { disconnect } = useWeb3AuthDisconnect();
  const { getAuthTokenInfo, token: rawCachedIdToken } = useAuthTokenInfo();
  // Published hook types omit null; runtime starts as null before authorize.
  const cachedIdToken = (rawCachedIdToken as string | null) ?? '';
  const [fetchedIdentity, setFetchedIdentity] =
    useState<ResolvedIdentity | null>(null);

  // `authorizing` is a transient step inside getAuthTokenInfo / reconnect;
  // treat it as still in-session so we don't wipe / cancel identity resolve.
  const sessionActive =
    isConnected ||
    connectorStatus === 'authorizing' ||
    connectorStatus === 'authorized';

  const cachedIdentity = useMemo((): ResolvedIdentity | null => {
    if (!sessionActive || cachedIdToken.length === 0) {
      return null;
    }
    return resolveIdentityFromIdToken(cachedIdToken);
  }, [sessionActive, cachedIdToken]);

  const getIdToken = useCallback(async () => {
    if (cachedIdToken.length > 0) {
      return cachedIdToken;
    }
    const token = ((await getAuthTokenInfo()) as string | null) ?? '';
    if (token.length === 0) {
      throw new Error('Web3Auth identity token unavailable.');
    }
    return token;
  }, [cachedIdToken, getAuthTokenInfo]);

  // Fetch only when connected with no cached JWT. setState stays in the async
  // callback so we do not trip react-hooks/set-state-in-effect.
  useEffect(() => {
    if (!isInitialized || !sessionActive || cachedIdentity !== null) {
      return;
    }

    const cancelled = { current: false };
    void (async () => {
      try {
        const idToken = ((await getAuthTokenInfo()) as string | null) ?? '';
        if (cancelled.current) {
          return;
        }
        if (idToken.length === 0) {
          throw new Error('Web3Auth identity token unavailable.');
        }
        setFetchedIdentity(resolveIdentityFromIdToken(idToken));
      } catch (error) {
        if (cancelled.current) {
          return;
        }
        setFetchedIdentity({
          address: null,
          error:
            error instanceof Error
              ? error.message
              : 'Web3Auth identity token unavailable.',
        });
      }
    })();

    return () => {
      cancelled.current = true;
    };
  }, [isInitialized, sessionActive, cachedIdentity, getAuthTokenInfo]);

  useEffect(() => {
    if (sessionActive) {
      return;
    }
    queueMicrotask(() => {
      setFetchedIdentity(null);
    });
  }, [sessionActive]);

  const resolved: ResolvedIdentity | null = !sessionActive
    ? null
    : (cachedIdentity ?? fetchedIdentity);

  const address = resolved?.address ?? null;
  const identityError = resolved?.error ?? null;

  const status: 'initializing' | 'disconnected' | 'connected' = !isInitialized
    ? 'initializing'
    : sessionActive && address !== null
      ? 'connected'
      : sessionActive && identityError === null
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
    connectError:
      connectError?.message ??
      (sessionActive && identityError !== null ? identityError : null),
    connect: connectWallet,
    disconnect: disconnectWallet,
    getIdToken,
  };
}
