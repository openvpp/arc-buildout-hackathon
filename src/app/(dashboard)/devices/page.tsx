import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { loadDashboardSnapshot } from '@/features/dashboard';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Devices',
  description: 'EV devices grouped by wallet.',
};

export const dynamic = 'force-dynamic';

export default async function DevicesPage() {
  const loaded = await loadDashboardSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Devices"
          description="EV devices grouped by the wallet that owns them."
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

  const deviceCount = loaded.snapshot.reduce(
    (sum, row) => sum + row.devices.length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Devices"
        description="EV devices grouped by the wallet that owns them."
      />

      {deviceCount === 0 ? (
        <EmptyState
          title="No devices yet"
          description="Seed demo data to populate devices."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {loaded.snapshot.map(({ wallet, devices }) => (
            <section
              key={wallet.id}
              aria-label={`Devices for ${wallet.label ?? wallet.address}`}
              className="flex flex-col gap-3"
            >
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {wallet.label ?? shortenAddress(wallet.address)}
              </h2>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {devices.map(({ device }) => (
                  <li key={device.id}>
                    <Card>
                      <CardTitle>
                        {device.displayName ?? device.externalDeviceId}
                      </CardTitle>
                      <CardDescription>
                        {device.vendor ?? 'Unknown vendor'}
                        {device.model ? ` · ${device.model}` : ''}
                      </CardDescription>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
