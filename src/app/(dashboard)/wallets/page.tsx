import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { loadDashboardSnapshot } from '@/features/dashboard';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Wallets',
  description: 'Wallets and their seller balances.',
};

export const dynamic = 'force-dynamic';

export default async function WalletsPage() {
  const loaded = await loadDashboardSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Wallets"
          description="Each wallet may own one or more devices. Telemetry and verification are shown per wallet and device."
        />
        <EmptyState
          title="Backend data unavailable"
          description={
            loaded.reason === 'no_seed_principal'
              ? 'Run pnpm db:migrate && pnpm db:seed, then refresh.'
              : 'Start Postgres (pnpm services:up), migrate, and ensure DATABASE_URL is set.'
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Wallets"
        description="Each wallet may own one or more devices. Telemetry and verification are shown per wallet and device."
      />

      {loaded.snapshot.length === 0 ? (
        <EmptyState
          title="No wallets yet"
          description="Seed demo data to populate wallets."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {loaded.snapshot.map(({ wallet, devices }) => (
            <li key={wallet.id}>
              <Card>
                <CardTitle>
                  {wallet.label ?? shortenAddress(wallet.address)}
                </CardTitle>
                <CardDescription>
                  <span className="font-mono">
                    {shortenAddress(wallet.address)}
                  </span>
                </CardDescription>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
                  {devices.length} {devices.length === 1 ? 'device' : 'devices'}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
