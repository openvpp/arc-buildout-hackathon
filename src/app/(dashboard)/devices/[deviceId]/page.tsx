import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatTimestamp, mintStatusTone } from '@/features/devices/format';
import { MintTransactionLink } from '@/features/devices/mint-transaction-link';
import { getDeviceForWallet } from '@/server/application/dashboard/get-device';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Device' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;
  const principal = await getCurrentPrincipal();

  if (principal === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Device" />
        <EmptyState
          title="Sign in to continue"
          description="Sign in with Google to view this device."
        />
      </div>
    );
  }

  const db = getDb();
  const device = await getDeviceForWallet(db, {
    deviceId,
    walletId: principal.walletId,
  });
  if (device === null) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={device.displayName ?? device.externalDeviceId}
        description={`${device.vendor ?? 'Unknown vendor'}${device.model !== null ? ` · ${device.model}` : ''}`}
      />
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={mintStatusTone(device.mintStatus)}>
            {device.mintStatus}
          </StatusBadge>
          <MintTransactionLink transactionHash={device.nftTransactionHash} />
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm text-slate-700 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              External ID
            </dt>
            <dd className="font-mono break-all">{device.externalDeviceId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Token ID
            </dt>
            <dd>{device.nftTokenId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Network
            </dt>
            <dd>{device.network ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Last seen
            </dt>
            <dd>
              {device.lastSeenAt !== null
                ? formatTimestamp(device.lastSeenAt)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Location
            </dt>
            <dd>
              {device.lastLatitude !== null && device.lastLongitude !== null
                ? `${device.lastLatitude}, ${device.lastLongitude}`
                : 'Unknown'}
            </dd>
          </div>
        </dl>
      </Card>
      <div className="flex gap-4 text-sm">
        <Link href="/devices" className="underline">
          Back to devices
        </Link>
        <Link href="/" className="underline">
          View on globe
        </Link>
      </div>
    </div>
  );
}
