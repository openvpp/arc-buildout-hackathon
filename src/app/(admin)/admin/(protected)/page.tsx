import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { loadAdminSnapshot } from '@/features/admin';
import { DeviceMintTransactionLink } from '@/features/devices';

export const metadata: Metadata = {
  title: 'Super Admin',
  description:
    'Cross-tenant view of wallets, devices, telemetry, and verification evidence.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function truncateHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 1) {
    return hash;
  }
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

function formatTimestamp(value: Date): string {
  return value.toISOString();
}

export default async function AdminPage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Super Admin"
          description="All bound wallets, devices, and telemetry history."
        />
        <EmptyState
          title="No data"
          description={
            loaded.reason === 'no_bound_wallets'
              ? 'No wallets are bound to any principal yet.'
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
  const historyCount = loaded.snapshot.reduce(
    (sum, row) =>
      sum + row.devices.reduce((inner, d) => inner + d.history.length, 0),
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
        title="Super Admin"
        description="Cross-tenant viewer for wallets, devices, latest telemetry, and recent history. Verification shown here is independent evidence only."
      />

      <section
        aria-labelledby="admin-overview-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-overview-heading" className="sr-only">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardTitle>Wallets</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {walletCount}
              </span>{' '}
              bound
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {deviceCount}
              </span>{' '}
              connected
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>History rows</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {historyCount}
              </span>{' '}
              shown
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Verified latest</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {verifiedCount}
              </span>{' '}
              devices
            </CardDescription>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="admin-wallets-heading"
        className="flex flex-col gap-6"
      >
        <h2
          id="admin-wallets-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Wallets, devices & telemetry
        </h2>

        {loaded.snapshot.map(({ wallet, bindings, devices }) => (
          <article
            key={wallet.id}
            className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"
          >
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {wallet.label ?? wallet.address}
              </h3>
              <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-400">
                {wallet.address}
              </p>
              <p className="text-xs text-slate-500">
                chain {wallet.chainId.toString()} · {wallet.status}
              </p>
              {bindings.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {bindings.map((binding) => (
                    <li key={`${binding.principalId}-${binding.role}`}>
                      {binding.displayName} · {binding.type} · {binding.role} ·{' '}
                      {binding.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No principal bindings</p>
              )}
            </header>

            {devices.length === 0 ? (
              <EmptyState
                title="No devices"
                description="This wallet has no connected devices."
              />
            ) : (
              devices.map(({ device, latest, verification, history }) => {
                const agentBadge = agentVerificationBadge(verification?.status);
                return (
                  <Card key={device.id}>
                    <CardTitle>
                      {device.displayName ?? device.externalDeviceId}
                    </CardTitle>
                    <CardDescription>
                      <span className="flex flex-col gap-3">
                        <span className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone="neutral">
                            {device.status}
                          </StatusBadge>
                          <StatusBadge tone={agentBadge.tone}>
                            {agentBadge.label}
                          </StatusBadge>
                        </span>
                        <span className="font-mono text-xs break-all">
                          {device.externalDeviceId}
                        </span>
                        <DeviceMintTransactionLink
                          nftTransactionHash={device.nftTransactionHash}
                          nftTokenId={device.nftTokenId}
                        />

                        {latest === null ? (
                          <span className="text-xs text-slate-500">
                            No telemetry yet
                          </span>
                        ) : (
                          <span className="flex flex-col gap-1 text-xs">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              Latest
                            </span>
                            <span>
                              recorded {formatTimestamp(latest.recordedAt)}
                            </span>
                            <span className="font-mono break-all">
                              hash {truncateHash(latest.contentHash, 14, 8)}
                            </span>
                            <span>device event {latest.anchorStatus}</span>
                            {verification?.paymentTransactionHash !==
                            undefined ? (
                              <span className="font-mono break-all">
                                payment{' '}
                                {truncateHash(
                                  verification.paymentTransactionHash,
                                  14,
                                  8,
                                )}
                              </span>
                            ) : null}
                          </span>
                        )}

                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium text-slate-800 dark:text-slate-200">
                            Recent history ({history.length})
                          </summary>
                          {history.length === 0 ? (
                            <p className="mt-2 text-slate-500">No records</p>
                          ) : (
                            <ul className="mt-2 flex flex-col gap-2 border-l border-slate-200 pl-3 dark:border-slate-700">
                              {history.map((row) => (
                                <li
                                  key={row.id}
                                  className="flex flex-col gap-0.5"
                                >
                                  <span>{formatTimestamp(row.recordedAt)}</span>
                                  <span className="font-mono break-all">
                                    {truncateHash(row.contentHash, 14, 8)}
                                  </span>
                                  <span>device event {row.anchorStatus}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </details>
                      </span>
                    </CardDescription>
                  </Card>
                );
              })
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
