'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { logger } from '@/lib/logger/logger';

import { createCircleSessionApi } from './session-api';

export type CircleSessionState =
  | { status: 'idle'; error: string | null }
  | { status: 'signing_in' }
  | { status: 'signed_in'; walletAddress: string };

const sessionApi = createCircleSessionApi();

/**
 * Drives the dashboard session lifecycle for Circle developer-controlled
 * wallet login: takes an email, establishes the httpOnly session cookie
 * server-side (creating/finding the Circle wallet for that email), and
 * refreshes RSCs so wallet-scoped data loads.
 */
export function useCircleSession(initialWalletAddress: string | null = null) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [state, setState] = useState<CircleSessionState>(
    initialWalletAddress !== null
      ? { status: 'signed_in', walletAddress: initialWalletAddress }
      : { status: 'idle', error: null },
  );

  const signInWithEmail = useCallback(
    async (email: string) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setState({ status: 'signing_in' });
      try {
        const result = await sessionApi.establish({ email });
        setState({ status: 'signed_in', walletAddress: result.walletAddress });
        router.refresh();
      } catch (error) {
        logger.error('circle_session.sign_in_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
        setState({
          status: 'idle',
          error: error instanceof Error ? error.message : 'Sign-in failed.',
        });
      } finally {
        inFlight.current = false;
      }
    },
    [router],
  );

  const signOut = useCallback(async () => {
    try {
      await sessionApi.clear();
    } finally {
      setState({ status: 'idle', error: null });
      router.refresh();
    }
  }, [router]);

  return { state, signInWithEmail, signOut };
}
