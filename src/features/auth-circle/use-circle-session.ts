'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import { logger } from '@/lib/logger/logger';

import { createCircleSessionApi } from './session-api';

export type CircleSessionState =
  | { status: 'idle'; error: string | null }
  | { status: 'signing_in' }
  | { status: 'signed_in'; walletAddress: string };

const sessionApi = createCircleSessionApi();

/**
 * Drives the dashboard session lifecycle for Circle developer-controlled
 * wallet login: takes a Google id_token, establishes the httpOnly session
 * cookie server-side, and refreshes RSCs so wallet-scoped data loads.
 */
export function useCircleSession() {
  const router = useRouter();
  const [state, setState] = useState<CircleSessionState>({
    status: 'idle',
    error: null,
  });

  const signInWithGoogleIdToken = useCallback(
    async (googleIdToken: string) => {
      setState({ status: 'signing_in' });
      try {
        const result = await sessionApi.establish({ googleIdToken });
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

  return { state, signInWithGoogleIdToken, signOut };
}
