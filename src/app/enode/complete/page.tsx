'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useTransition } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
  isWeb3AuthConfigured,
  RequireWeb3Auth,
  resolveWalletAddressForOnboarding,
  useConfiguredWalletSession,
  WalletConnectButton,
} from '@/features/auth';
import { createOnboardingApi } from '@/features/onboarding';

type OauthState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'needs_form'; pendingId: string }
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string };

function EnodeCompleteConfigured() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ovppPending = searchParams.get('ovppPending');
  const session = useConfiguredWalletSession();
  const {
    isReady: sessionReady,
    status: sessionStatus,
    address: sessionAddress,
    getIdToken,
  } = session;
  const [nickname, setNickname] = useState('');
  const [oauth, setOauth] = useState<OauthState>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (ovppPending === null) {
      return;
    }
    if (
      !sessionReady ||
      sessionStatus !== 'connected' ||
      sessionAddress === null
    ) {
      return;
    }

    const pendingId = ovppPending;
    const wallet = sessionAddress;
    const controller = new AbortController();

    void (async () => {
      setOauth({ kind: 'loading' });
      try {
        const idToken = await getIdToken();
        const boundWalletAddress = resolveWalletAddressForOnboarding({
          idToken,
          sessionAddress: wallet,
        });
        const api = createOnboardingApi();
        await api.completeOAuth({
          idToken,
          ovppPending: pendingId,
          walletAddress: boundWalletAddress,
        });
        if (!controller.signal.aborted) {
          setOauth({ kind: 'needs_form', pendingId });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setOauth({
            kind: 'error',
            message: e instanceof Error ? e.message : 'OAuth complete failed',
          });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [ovppPending, sessionReady, sessionStatus, sessionAddress, getIdToken]);

  function finish() {
    if (oauth.kind !== 'needs_form' || session.address === null) {
      return;
    }
    const walletAddress = session.address;
    startTransition(async () => {
      try {
        const idToken = await session.getIdToken();
        const boundWalletAddress = resolveWalletAddressForOnboarding({
          idToken,
          sessionAddress: walletAddress,
        });
        const api = createOnboardingApi();
        await api.finalize({
          idToken,
          pendingId: oauth.pendingId,
          walletAddress: boundWalletAddress,
          ...(nickname.trim().length > 0 ? { nickname: nickname.trim() } : {}),
        });
        setOauth({ kind: 'redirecting' });
        router.replace('/devices');
      } catch (e) {
        setOauth({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Finalize failed',
        });
      }
    });
  }

  const view:
    OauthState | { kind: 'needs_wallet' } | { kind: 'missing_pending' } =
    ovppPending === null
      ? { kind: 'missing_pending' }
      : !session.isReady
        ? { kind: 'loading' }
        : session.status !== 'connected' || session.address === null
          ? { kind: 'needs_wallet' }
          : oauth.kind === 'idle'
            ? { kind: 'loading' }
            : oauth;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
      <PageHeader
        title="Enode complete"
        description="Finish linking your vehicle after OEM authorization."
      />

      <Card>
        {view.kind === 'loading' ? (
          <CardDescription>Confirming Enode connection…</CardDescription>
        ) : null}

        {view.kind === 'needs_wallet' ? (
          <>
            <CardTitle>Reconnect wallet</CardTitle>
            <CardDescription>
              Sign in with the same Web3Auth account you used to start linking.
            </CardDescription>
            <div className="mt-4">
              <WalletConnectButton />
            </div>
          </>
        ) : null}

        {view.kind === 'missing_pending' || view.kind === 'error' ? (
          <>
            <CardTitle>Could not finish</CardTitle>
            <CardDescription>
              <span role="alert">
                {view.kind === 'missing_pending'
                  ? 'Missing ovppPending. Restart onboarding from Devices → Add vehicle.'
                  : view.message}
              </span>
            </CardDescription>
            <div className="mt-4">
              <Link
                href="/devices/onboard"
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
              >
                Try again
              </Link>
            </div>
          </>
        ) : null}

        {view.kind === 'needs_form' ? (
          <>
            <CardTitle>Name your vehicle</CardTitle>
            <CardDescription>
              Optional nickname, then save the device to{' '}
              <span className="font-mono text-xs">{session.address}</span>.
            </CardDescription>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-medium">Nickname</span>
              <input
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                }}
                placeholder="My EV"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
              />
            </label>
            <div className="mt-4">
              <Button type="button" disabled={pending} onClick={finish}>
                {pending ? 'Saving…' : 'Save device'}
              </Button>
            </div>
          </>
        ) : null}

        {view.kind === 'redirecting' ? (
          <CardDescription>Vehicle linked. Opening devices…</CardDescription>
        ) : null}
      </Card>
    </div>
  );
}

function EnodeCompleteInner() {
  if (!isWeb3AuthConfigured()) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
        <PageHeader
          title="Enode complete"
          description="Finish linking your vehicle."
        />
        <Card>
          <CardTitle>Connect unavailable</CardTitle>
          <CardDescription>
            Wallet login is not available right now. Return to devices and try
            again later.
          </CardDescription>
        </Card>
      </div>
    );
  }
  return (
    <RequireWeb3Auth
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-sm text-slate-600">
          Initializing wallet…
        </div>
      }
    >
      <EnodeCompleteConfigured />
    </RequireWeb3Auth>
  );
}

export default function EnodeCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-4 py-10 text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <EnodeCompleteInner />
    </Suspense>
  );
}
