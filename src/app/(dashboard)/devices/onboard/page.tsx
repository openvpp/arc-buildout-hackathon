'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useSyncExternalStore, useTransition } from 'react';

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

/**
 * Temporary Enode vehicle onboarding starter.
 * Wallet address is a stub until Web3Auth lands.
 */
export default function DeviceOnboardPage() {
  const router = useRouter();
  const stored = useStoredWalletAddress();
  const [walletAddress, setWalletAddress] = useState(stored);
  const [brand, setBrand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        window.localStorage.setItem(WALLET_STORAGE_KEY, walletAddress.trim());
        const api = createOnboardingApi();
        const data = await api.startLink({
          walletAddress: walletAddress.trim(),
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Add vehicle"
        description="Connect an EV through Enode Link. Wallet auth is temporary until Web3Auth."
      />

      <Card>
        <CardTitle>Enode vehicle link</CardTitle>
        <CardDescription>
          You will be redirected to Enode / OEM login, then returned to this app
          to finish onboarding.
        </CardDescription>

        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Wallet address (stub)
            </span>
            <input
              required
              pattern="^0x[a-fA-F0-9]{40}$"
              value={walletAddress}
              onChange={(e) => {
                setWalletAddress(e.target.value);
              }}
              placeholder="0x…"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </label>

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
            <Button type="submit" disabled={pending}>
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
      </Card>

      <p className="text-sm text-slate-600 dark:text-slate-400">
        <Link href="/devices" className="underline">
          Back to devices
        </Link>
      </p>
    </div>
  );
}
