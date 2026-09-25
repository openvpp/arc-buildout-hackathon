import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { listDevicesForWallet } from '@/server/application/dashboard/list-devices';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';
import { mintStatusTone, formatTimestamp } from '@/features/devices/format';
import { MintTransactionLink } from '@/features/devices/mint-transaction-link';

export const metadata: Metadata = {
  title: 'Devices',
  description: 'Your connected EVs.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DevicesPage() {
  const principal = await getCurrentPrincipal();

  if (principal === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Devices"
          description="Your connected EVs, minted on Arc."
        />
        <EmptyState
          title="Sign in to continue"
          description="Sign in with Google to create or access your Circle wallet."
        />
      </div>
    );
  }

  const db = getDb();
  const deviceList = await listDevicesForWallet(db, {
    walletId: principal.walletId,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Devices"
        description="Your connected EVs, minted on Arc."
      />
      <div>
        <Link
          href="/devices/onboard"
          className="inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
        >
          Add vehicle
        </Link>
      </div>

      {deviceList.length === 0 ? (
        <EmptyState
          title="No devices yet"
          description="Connect an EV with Enode Link to populate devices."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {deviceList.map((device) => (
            <li key={device.id}>
              <Card className="flex h-full flex-col gap-3">
                <div>
                  <CardTitle>
                    {device.displayName ?? device.externalDeviceId}
                  </CardTitle>
                  <CardDescription>
                    {device.vendor ?? 'Unknown vendor'}
                    {device.model !== null ? ` · ${device.model}` : ''}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={mintStatusTone(device.mintStatus)}>
                    {device.mintStatus}
                  </StatusBadge>
                  <MintTransactionLink
                    transactionHash={device.nftTransactionHash}
                  />
                </div>
                <dl className="grid grid-cols-1 gap-2 text-xs text-slate-600">
                  <div>
                    <dt className="font-medium tracking-wide text-slate-500 uppercase">
                      External ID
                    </dt>
                    <dd className="font-mono break-all">
                      {device.externalDeviceId}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium tracking-wide text-slate-500 uppercase">
                      Last seen
                    </dt>
                    <dd>
                      {device.lastSeenAt !== null
                        ? formatTimestamp(device.lastSeenAt)
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
