'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

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

function UnconfiguredOnboard() {
  return (
    <Card>
      <CardTitle>Connect unavailable</CardTitle>
      <CardDescription>
        Wallet login is not available right now. Try again later or contact the
        demo host.
      </CardDescription>
    </Card>
  );
}

function InitializingOnboard() {
  return (
    <Card>
      <CardTitle>Enode vehicle link</CardTitle>
      <CardDescription>Initializing wallet…</CardDescription>
    </Card>
  );
}

function OnboardForm() {
  const router = useRouter();
  const session = useConfiguredWalletSession();
  const [brand, setBrand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (session.address === null) {
      setError('Connect your wallet before starting Enode Link.');
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
        const data = await api.startLink({
          idToken,
          walletAddress: boundWalletAddress,
          ...(brand.trim().length > 0 ? { brand: brand.trim() } : {}),
          frontendUrl: window.location.origin,
        });
        window.location.href = data.linkUrl;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unexpected error');
      }
    });
  }

  return (
    <Card>
      <CardTitle>Enode vehicle link</CardTitle>
      <CardDescription>
        Sign in with Web3Auth, then continue to Enode / OEM login. You will
        return here to finish onboarding.
      </CardDescription>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            {session.status === 'connected' && session.address !== null ? (
              <>
                Connected:{' '}
                <span className="font-mono text-xs">{session.address}</span>
              </>
            ) : session.status === 'initializing' ? (
              'Initializing wallet…'
            ) : (
              'Connect a wallet to continue'
            )}
          </div>
          <WalletConnectButton />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Brand / vendor (optional)
            </span>
            <input
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
              }}
              placeholder="TESLA"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>

          {error !== null ? (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={
                pending ||
                session.status !== 'connected' ||
                session.address === null
              }
            >
              {pending ? 'Starting…' : 'Connect with Enode'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                router.push('/devices');
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}

export default function DeviceOnboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add vehicle"
        description="Connect an EV through Enode Link using your Web3Auth wallet."
      />
      {isWeb3AuthConfigured() ? (
        <RequireWeb3Auth fallback={<InitializingOnboard />}>
          <OnboardForm />
        </RequireWeb3Auth>
      ) : (
        <UnconfiguredOnboard />
      )}
      <p className="text-sm text-slate-600 dark:text-slate-400">
        <Link href="/devices" className="underline">
          Back to devices
        </Link>
      </p>
    </div>
  );
}
