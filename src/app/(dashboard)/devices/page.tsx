import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageContainer } from '@/components/layout/page-container';
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
      <PageContainer>
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
      </PageContainer>
    );
  }

  const db = getDb();
  const deviceList = await listDevicesForWallet(db, {
    walletId: principal.walletId,
  });

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <PageHeader
            title="Devices"
            description="Your connected EVs, minted on Arc."
          />
          <Link
            href="/devices/onboard"
            className="inline-flex h-[42px] items-center rounded-md border border-primary-500 px-4 text-sm font-medium text-primary-500 hover:bg-primary-500/10 sm:hidden"
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
                  <dl className="grid grid-cols-1 gap-2 text-xs text-white/50">
                    <div>
                      <dt className="font-medium tracking-wide text-white/40 uppercase">
                        External ID
                      </dt>
                      <dd className="font-mono break-all">
                        {device.externalDeviceId}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium tracking-wide text-white/40 uppercase">
                        Last seen
                      </dt>
                      <dd>
                        {device.lastSeenAt !== null
                          ? formatTimestamp(device.lastSeenAt)
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                  <Link
                    href={`/devices/${device.id}`}
                    className="mt-auto text-sm font-medium text-primary-500 underline"
                  >
                    View device
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageContainer>
  );
}
