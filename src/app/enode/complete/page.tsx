'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { createOnboardingApi } from '@/features/onboarding';

const WALLET_STORAGE_KEY = 'ev_onboard_wallet_address';

function useStoredWalletAddress(): string {
  return useSyncExternalStore(
    () => () => undefined,
    () => window.localStorage.getItem(WALLET_STORAGE_KEY) ?? '',
    () => '',
  );
}

type CompleteState =
  | { kind: 'loading' }
  | { kind: 'needs_form'; pendingId: string }
  | { kind: 'done'; deviceName: string }
  | { kind: 'error'; message: string };

function EnodeCompleteInner() {
  const searchParams = useSearchParams();
  const ovppPending = searchParams.get('ovppPending');
  const walletAddress = useStoredWalletAddress();
  const [nickname, setNickname] = useState('');
  const missingSetup =
    ovppPending === null || walletAddress.trim().length === 0;
  const [state, setState] = useState<CompleteState>(
    missingSetup
      ? {
          kind: 'error',
          message:
            'Missing ovppPending or saved wallet address. Restart onboarding from Devices → Add vehicle.',
        }
      : { kind: 'loading' },
  );
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (ovppPending === null || walletAddress.trim().length === 0) {
      return;
    }
    const pendingId = ovppPending;
    const wallet = walletAddress.trim();
    const controller = new AbortController();

    void (async () => {
      try {
        const api = createOnboardingApi();
        await api.completeOAuth({
          ovppPending: pendingId,
          walletAddress: wallet,
        });
        if (!controller.signal.aborted) {
          setState({ kind: 'needs_form', pendingId });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'OAuth complete failed',
          });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [ovppPending, walletAddress]);

  function finish() {
    if (state.kind !== 'needs_form') {
      return;
    }
    startTransition(async () => {
      try {
        const api = createOnboardingApi();
        const data = await api.finalize({
          pendingId: state.pendingId,
          walletAddress: walletAddress.trim(),
          ...(nickname.trim().length > 0 ? { nickname: nickname.trim() } : {}),
        });
        setState({
          kind: 'done',
          deviceName: data.device.displayName ?? 'Vehicle',
        });
      } catch (e) {
        setState({
          kind: 'error',
          message: e instanceof Error ? e.message : 'Finalize failed',
        });
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
      <PageHeader
        title="Enode complete"
        description="Finish linking your vehicle after OEM authorization."
      />

      <Card>
        {state.kind === 'loading' ? (
          <CardDescription>Confirming Enode connection…</CardDescription>
        ) : null}

        {state.kind === 'error' ? (
          <>
            <CardTitle>Could not finish</CardTitle>
            <CardDescription>
              <span role="alert">{state.message}</span>
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

        {state.kind === 'needs_form' ? (
          <>
            <CardTitle>Name your vehicle</CardTitle>
            <CardDescription>
              Optional nickname, then save the device to this wallet.
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

        {state.kind === 'done' ? (
          <>
            <CardTitle>Connected</CardTitle>
            <CardDescription>
              {state.deviceName} is linked. Telemetry can arrive via Enode
              webhooks.
            </CardDescription>
            <div className="mt-4 flex gap-3">
              <Link
                href="/devices"
                className="inline-flex items-center justify-center rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
              >
                View devices
              </Link>
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium"
              >
                Dashboard
              </Link>
            </div>
          </>
        ) : null}
      </Card>
    </div>
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
