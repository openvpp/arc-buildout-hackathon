'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, useTransition } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { createOnboardingApi } from '@/features/onboarding/client-api';

type OauthState =
  | { kind: 'loading' }
  | { kind: 'needs_form'; pendingId: string }
  | { kind: 'redirecting' }
  | { kind: 'error'; message: string };

function EnodeCompleteInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pendingId = searchParams.get('pendingId');
  const [nickname, setNickname] = useState('');
  const [oauth, setOauth] = useState<OauthState>({ kind: 'loading' });
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (pendingId === null) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const api = createOnboardingApi();
        await api.completeOAuth({ pendingId });
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
  }, [pendingId]);

  function finish() {
    if (oauth.kind !== 'needs_form') {
      return;
    }
    const currentPendingId = oauth.pendingId;
    startTransition(async () => {
      try {
        const api = createOnboardingApi();
        await api.finalize({
          pendingId: currentPendingId,
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

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
      <PageHeader
        title="Enode complete"
        description="Finish linking your vehicle after OEM authorization."
      />
      <Card>
        {pendingId === null ? (
          <>
            <CardTitle>Could not finish</CardTitle>
            <CardDescription>
              <span role="alert">
                Missing pendingId. Restart onboarding from Devices → Add
                vehicle.
              </span>
            </CardDescription>
          </>
        ) : null}

        {oauth.kind === 'loading' ? (
          <CardDescription>Confirming Enode connection…</CardDescription>
        ) : null}

        {oauth.kind === 'error' ? (
          <>
            <CardTitle>Could not finish</CardTitle>
            <CardDescription>
              <span role="alert">{oauth.message}</span>
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

        {oauth.kind === 'needs_form' ? (
          <>
            <CardTitle>Name your vehicle</CardTitle>
            <CardDescription>Optional nickname, then save.</CardDescription>
            <label className="mt-4 flex flex-col gap-1 text-sm">
              <span className="font-medium">Nickname</span>
              <input
                value={nickname}
                onChange={(e) => {
                  setNickname(e.target.value);
                }}
                placeholder="My EV"
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-4">
              <Button type="button" disabled={pending} onClick={finish}>
                {pending ? 'Saving…' : 'Save device'}
              </Button>
            </div>
          </>
        ) : null}

        {oauth.kind === 'redirecting' ? (
          <CardDescription>Vehicle linked. Opening devices…</CardDescription>
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
