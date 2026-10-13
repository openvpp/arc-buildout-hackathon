'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { logger } from '@/lib/logger/logger';

import {
  createCircleSessionApi,
  type PasswordSignInIntent,
} from './session-api';

export type CircleSessionState =
  | { status: 'idle'; error: string | null }
  | { status: 'signing_in' }
  | { status: 'signed_in'; walletAddress: string };

const sessionApi = createCircleSessionApi();

/**
 * Drives the dashboard session lifecycle for Circle developer-controlled
 * wallet login. Email and password are sent for the server to check. The
 * httpOnly session cookie is set only after the server has found or
 * created the Circle wallet.
 */
export function useCircleSession(initialWalletAddress: string | null = null) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [state, setState] = useState<CircleSessionState>(
    initialWalletAddress !== null
      ? { status: 'signed_in', walletAddress: initialWalletAddress }
      : { status: 'idle', error: null },
  );

  const finishSignIn = useCallback(
    async (run: () => Promise<{ walletAddress: string }>) => {
      if (inFlight.current) {
        return;
      }
      inFlight.current = true;
      setState({ status: 'signing_in' });
      try {
        const result = await run();
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

  const signInWithPassword = useCallback(
    async (input: {
      email: string;
      password: string;
      intent: PasswordSignInIntent;
    }) => {
      await finishSignIn(() => sessionApi.establishWithPassword(input));
    },
    [finishSignIn],
  );

  const signOut = useCallback(async () => {
    try {
      await sessionApi.clear();
    } finally {
      setState({ status: 'idle', error: null });
      router.refresh();
    }
  }, [router]);

  return { state, signInWithPassword, signOut };
}
