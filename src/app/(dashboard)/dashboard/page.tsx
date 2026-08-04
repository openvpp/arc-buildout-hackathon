import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { ExternalLink } from '@/components/common/external-link';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { env } from '@/config/env';
import {
  loadDashboardSnapshot,
  RequestTelemetryPanel,
} from '@/features/dashboard';
import { verificationTone } from '@/features/verification';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Overview of telemetry and verification status.',
};

export const dynamic = 'force-dynamic';

function mapVerificationStatus(
  status: string | undefined,
): 'not_started' | 'verifying' | 'verified' | 'failed' {
  if (status === undefined) {
    return 'not_started';
  }
  switch (status) {
    case 'VERIFIED':
      return 'verified';
    case 'TX_MISSING':
    case 'TX_FAILED':
    case 'HASH_MISMATCH':
    case 'ERROR':
      return 'failed';
    default:
      return 'not_started';
  }
}

function readStateOfCharge(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '—';
  }
  const value = (payload as Record<string, unknown>)['stateOfChargePercent'];
  return value === undefined || value === null ? '—' : String(value);
}

export default async function DashboardPage() {
  const loaded = await loadDashboardSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Dashboard"
          description="Verified EV telemetry and independent on-chain verification, per wallet and device."
        />
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
        description="Verified EV telemetry and independent on-chain verification, per wallet and device."
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
              agent-verified
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
          Latest telemetry by wallet and device
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
                const tone = verificationTone(
                  mapVerificationStatus(verification?.status),
                );
                const txHash = verification?.paymentTransactionHash;
                return (
                  <Card key={device.id}>
                    <CardTitle>
                      {device.displayName ?? device.externalDeviceId}
                    </CardTitle>
                    <CardDescription>
                      {latest === null ? (
                        'No telemetry yet'
                      ) : (
                        <span className="flex flex-col gap-2">
                          <span>
                            SoC: {readStateOfCharge(latest.telemetryPayload)}% ·
                            recorded {latest.recordedAt.toISOString()}
                          </span>
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={tone}>
                              {verification?.status ?? 'NOT_VERIFIED'}
                            </StatusBadge>
                            {txHash !== undefined && txHash.startsWith('0x') ? (
                              <ExternalLink
                                href={`${env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL}/tx/${txHash}`}
                              >
                                Payment tx
                              </ExternalLink>
                            ) : null}
                          </span>
                          <span className="font-mono text-xs break-all">
                            contentHash: {latest.contentHash}
                          </span>
                        </span>
                      )}
                    </CardDescription>
                    <RequestTelemetryPanel
                      walletAddress={wallet.address}
                      deviceId={device.id}
                      deviceLabel={
                        device.displayName ?? device.externalDeviceId
                      }
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
