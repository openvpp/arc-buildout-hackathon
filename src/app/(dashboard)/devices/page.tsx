import type { Metadata } from 'next';
import Link from 'next/link';

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
        <div>
          <Link
            href="/devices/onboard"
            className="inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
          >
            Add vehicle
          </Link>
        </div>
        <EmptyState
          title="Backend data unavailable"
          description={
            loaded.reason === 'no_bound_wallets'
              ? 'No bound wallets yet. Run pnpm db:seed and/or complete Web3Auth onboarding.'
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

      <div>
        <Link
          href="/devices/onboard"
          className="inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
        >
          Add vehicle
        </Link>
      </div>

      {deviceCount === 0 ? (
        <EmptyState
          title="No devices yet"
          description="Connect an EV with Enode Link to populate devices."
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
