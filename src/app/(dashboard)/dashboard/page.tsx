import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  loadDashboardSnapshot,
  RequestTelemetryPanel,
} from '@/features/dashboard';
import {
  DeviceMintTransactionLink,
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
} from '@/features/devices';

export const metadata: Metadata = {
  title: 'Dashboard',
  description:
    'Request, unlock, and verify EV telemetry per wallet and device.',
};

export const dynamic = 'force-dynamic';

function agentVerificationBadge(status: string | undefined): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === undefined) {
    return { tone: 'neutral', label: 'Not verified' };
  }
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'VERIFIED' };
  }
  return { tone: 'danger', label: status };
}

export default async function DashboardPage() {
  const loaded = await loadDashboardSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Dashboard"
          description="Request, unlock, and verify EV telemetry per wallet and device."
        />
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

  const walletCount = loaded.snapshot.length;
  const deviceCount = loaded.snapshot.reduce(
    (sum, row) => sum + row.devices.length,
    0,
  );
  const verifiedCount = loaded.snapshot.reduce(
    (sum, row) =>
      sum +
      row.devices.filter((d) => d.verification?.status === 'VERIFIED').length,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Telemetry stays locked until you request a quote and pay. After unlock, Verify on Arc to add independent evidence."
      />

      <section
        aria-labelledby="overview-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="overview-heading" className="sr-only">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardTitle>Wallets</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {walletCount}
              </span>{' '}
              wallets
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {deviceCount}
              </span>{' '}
              devices
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Verified records</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {verifiedCount}
              </span>{' '}
              independently verified
            </CardDescription>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="records-heading"
        className="flex flex-col gap-4"
      >
        <h2
          id="records-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Devices — request & unlock
        </h2>

        {loaded.snapshot.length === 0 ? (
          <EmptyState
            title="No wallets yet"
            description="Seed demo data to populate wallets and devices."
          />
        ) : (
          loaded.snapshot.map(({ wallet, devices }) => (
            <div key={wallet.id} className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {wallet.label ?? wallet.address}
              </h3>
              {devices.map(({ device, latest, verification }) => {
                const agentBadge = agentVerificationBadge(verification?.status);
                const label = deviceDisplayName(device);
                return (
                  <Card key={device.id}>
                    <CardTitle>{label}</CardTitle>
                    <CardDescription>
                      <span className="flex flex-col gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="warning">Locked</StatusBadge>
                          <StatusBadge tone={deviceStatusTone(device.status)}>
                            {device.status}
                          </StatusBadge>
                          <StatusBadge tone={agentBadge.tone}>
                            {agentBadge.label}
                          </StatusBadge>
                          <DeviceMintTransactionLink
                            nftTransactionHash={device.nftTransactionHash}
                            nftTokenId={device.nftTokenId}
                          />
                        </span>
                        <span>
                          {device.vendor ?? 'Unknown vendor'}
                          {device.model ? ` · ${device.model}` : ''}
                          {' · '}
                          <span className="font-mono text-xs">
                            {device.externalDeviceId}
                          </span>
                        </span>
                        <span>
                          Latest record:{' '}
                          {latest === null
                            ? 'none yet'
                            : formatTimestamp(latest.recordedAt)}
                        </span>
                        <Link
                          href={`/devices/${device.id}`}
                          className="w-fit font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
                        >
                          View vehicle & telemetry history
                        </Link>
                      </span>
                    </CardDescription>
                    <RequestTelemetryPanel
                      walletAddress={wallet.address}
                      deviceId={device.id}
                      deviceLabel={label}
                    />
                  </Card>
                );
              })}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
