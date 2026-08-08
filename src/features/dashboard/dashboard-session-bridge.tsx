'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
  const [syncError, setSyncError] = useState<string | null>(null);

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
          // Wallet comes from the verified JWT on the server — no wagmi claim.
          await sessionApi.establish({ idToken });
          syncedAddressRef.current = address;
          clearedUnauthRef.current = false;
          setSyncError(null);
          router.refresh();
        } catch (error: unknown) {
          syncedAddressRef.current = null;
          setSyncError(
            error instanceof Error
              ? error.message
              : 'Dashboard session sync failed.',
          );
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
        setSyncError(null);
        router.refresh();
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, [status, address, getIdToken, router]);

  if (syncError === null) {
    return null;
  }

  return (
    <p
      role="alert"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      Wallet connected, but dashboard session failed: {syncError}. Disconnect
      and reconnect, or refresh after login.
    </p>
  );
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
