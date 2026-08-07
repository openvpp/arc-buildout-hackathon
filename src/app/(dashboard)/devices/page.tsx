import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { loadDashboardSnapshot } from '@/features/dashboard';
import {
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  mintStatusTone,
  readDeviceMetadata,
  truncateHash,
} from '@/features/devices';
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
          title="No data"
          description={
            loaded.reason === 'no_bound_wallets'
              ? 'Connect a wallet and onboard a device to get started.'
              : 'Nothing to show right now.'
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
                {devices.map(({ device, latest, verification }) => {
                  const meta = readDeviceMetadata(device.metadata);
                  return (
                    <li key={device.id}>
                      <Card className="flex h-full flex-col gap-3">
                        <div>
                          <CardTitle>{deviceDisplayName(device)}</CardTitle>
                          <CardDescription>
                            {device.vendor ?? 'Unknown vendor'}
                            {device.model ? ` · ${device.model}` : ''}
                            {meta.year !== null ? ` · ${meta.year}` : ''}
                          </CardDescription>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={deviceStatusTone(device.status)}>
                            {device.status}
                          </StatusBadge>
                          <StatusBadge tone={mintStatusTone(device.mintStatus)}>
                            mint {device.mintStatus}
                          </StatusBadge>
                          {verification?.status === 'VERIFIED' ? (
                            <StatusBadge tone="success">VERIFIED</StatusBadge>
                          ) : null}
                        </div>

                        <dl className="grid grid-cols-1 gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <div>
                            <dt className="font-medium tracking-wide text-slate-500 uppercase dark:text-slate-500">
                              External ID
                            </dt>
                            <dd className="font-mono break-all">
                              {device.externalDeviceId}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium tracking-wide text-slate-500 uppercase dark:text-slate-500">
                              Type
                            </dt>
                            <dd>{device.deviceType}</dd>
                          </div>
                          {meta.provider !== null ? (
                            <div>
                              <dt className="font-medium tracking-wide text-slate-500 uppercase dark:text-slate-500">
                                Provider
                              </dt>
                              <dd>{meta.provider}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt className="font-medium tracking-wide text-slate-500 uppercase dark:text-slate-500">
                              Last seen
                            </dt>
                            <dd>
                              {device.lastSeenAt
                                ? formatTimestamp(device.lastSeenAt)
                                : '—'}
                            </dd>
                          </div>
                          <div>
                            <dt className="font-medium tracking-wide text-slate-500 uppercase dark:text-slate-500">
                              Latest record
                            </dt>
                            <dd>
                              {latest === null
                                ? 'No telemetry yet'
                                : `${formatTimestamp(latest.recordedAt)} · anchor ${latest.anchorStatus} · ${truncateHash(latest.contentHash, 10, 6)}`}
                            </dd>
                          </div>
                        </dl>

                        <Link
                          href={`/devices/${device.id}`}
                          className="mt-auto inline-flex text-sm font-medium text-slate-900 underline decoration-2 underline-offset-4 dark:text-slate-100"
                        >
                          View vehicle & telemetry
                        </Link>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
