'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  isWeb3AuthConfigured,
  RequireWagmi,
  useConfiguredWalletSession,
} from '@/features/auth';

import { createDashboardSessionApi } from './dashboard-session-api';

const sessionApi = createDashboardSessionApi();

/**
 * Keeps the httpOnly dashboard session cookie aligned with Web3Auth connect
 * state, then refreshes RSCs so wallet-scoped data loads.
 */
function DashboardSessionSyncInner() {
  const session = useConfiguredWalletSession();
  const router = useRouter();
  const syncedAddressRef = useRef<string | null>(null);
  const clearedUnauthRef = useRef(false);
  const inFlightRef = useRef(false);

  const { status, address, getIdToken } = session;

  useEffect(() => {
    if (status === 'connected' && address !== null) {
      if (syncedAddressRef.current === address || inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      void (async () => {
        try {
          const idToken = await getIdToken();
          await sessionApi.establish({ idToken, walletAddress: address });
          syncedAddressRef.current = address;
          clearedUnauthRef.current = false;
          router.refresh();
        } catch {
          syncedAddressRef.current = null;
        } finally {
          inFlightRef.current = false;
        }
      })();
      return;
    }

    if (status !== 'disconnected' || inFlightRef.current) {
      return;
    }

    const hadSynced = syncedAddressRef.current !== null;
    if (!hadSynced && clearedUnauthRef.current) {
      return;
    }

    inFlightRef.current = true;
    void (async () => {
      try {
        await sessionApi.clear();
        syncedAddressRef.current = null;
        clearedUnauthRef.current = true;
        router.refresh();
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [status, address, getIdToken, router]);

  return null;
}

/** Mount in the owner dashboard layout when Web3Auth is configured. */
export function DashboardSessionBridge() {
  if (!isWeb3AuthConfigured()) {
    return null;
  }
  return (
    <RequireWagmi fallback={null}>
      <DashboardSessionSyncInner />
    </RequireWagmi>
  );
}
