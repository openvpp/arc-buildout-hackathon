import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { loadAdminDeviceDetail } from '@/features/admin';
import {
  DeviceEventTransactionLink,
  DeviceMintTransactionLink,
  SettlementPaymentRef,
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  readDeviceMetadata,
  truncateHash,
} from '@/features/devices';
import { readTelemetryReadingFields } from '@/features/telemetry';
import { shortenAddress } from '@/features/wallets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PageProps = {
  readonly params: Promise<{ readonly deviceId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { deviceId } = await params;
  const loaded = await loadAdminDeviceDetail(deviceId);
  if (!loaded.ok) {
    return { title: 'Vehicle · Super Admin' };
  }
  return {
    title: `${deviceDisplayName(loaded.detail.device)} · Super Admin`,
    description: 'Cross-tenant vehicle detail with unlocked telemetry.',
  };
}

function agentVerificationBadge(status: string | null | undefined): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === null || status === undefined) {
    return { tone: 'neutral', label: 'Not verified' };
  }
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'VERIFIED' };
  }
  if (status === 'PENDING_ONCHAIN') {
    return { tone: 'warning', label: 'Pending on Arc' };
  }
  return { tone: 'danger', label: status };
}

export default async function AdminDeviceDetailPage({ params }: PageProps) {
  const { deviceId } = await params;
  const loaded = await loadAdminDeviceDetail(deviceId);

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      notFound();
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Vehicle"
          description="Cross-tenant vehicle details and full telemetry history."
        />
        <EmptyState
          title="Unavailable"
          description="Could not load this vehicle right now."
        />
      </div>
    );
  }

  const { wallet, bindings, device, verification, history } = loaded.detail;
  const meta = readDeviceMetadata(device.metadata);
  const agentBadge = agentVerificationBadge(verification?.status);
  const label = deviceDisplayName(device);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin"
          className="text-sm font-medium text-slate-600 underline decoration-2 underline-offset-4 dark:text-slate-400"
        >
          ← All tenants
        </Link>
        <PageHeader
          title={label}
          description="Super-admin view: unlocked readings for every record, plus settlement and verification evidence."
        />
      </div>

      <section
        aria-labelledby="admin-vehicle-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="admin-vehicle-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Vehicle
        </h2>
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">Unlocked view</StatusBadge>
            <StatusBadge tone={deviceStatusTone(device.status)}>
              {device.status}
            </StatusBadge>
            <StatusBadge tone={agentBadge.tone}>{agentBadge.label}</StatusBadge>
            <DeviceMintTransactionLink
              nftTransactionHash={device.nftTransactionHash}
              nftTokenId={device.nftTokenId}
            />
          </div>

          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <DetailField label="Vendor" value={device.vendor ?? '—'} />
            <DetailField label="Model" value={device.model ?? '—'} />
            <DetailField label="Type" value={device.deviceType} />
            <DetailField label="Year" value={meta.year ?? '—'} />
            <DetailField label="Provider" value={meta.provider ?? '—'} />
            <DetailField
              label="External ID"
              value={device.externalDeviceId}
              mono
            />
            <DetailField
              label="Wallet"
              value={wallet.label ?? shortenAddress(wallet.address)}
            />
            <DetailField label="Wallet address" value={wallet.address} mono />
            <DetailField
              label="Last seen"
              value={
                device.lastSeenAt ? formatTimestamp(device.lastSeenAt) : '—'
              }
              mono
            />
            <DetailField
              label="Created"
              value={formatTimestamp(device.createdAt)}
              mono
            />
            {device.nftTokenId !== null ? (
              <DetailField label="NFT token" value={device.nftTokenId} mono />
            ) : null}
            {device.nftContractAddress !== null ? (
              <DetailField
                label="NFT contract"
                value={device.nftContractAddress}
                mono
              />
            ) : null}
            {device.network !== null ? (
              <DetailField label="Network" value={device.network} />
            ) : null}
          </dl>

          <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-700">
            <h3 className="text-xs font-medium tracking-wide text-slate-500 uppercase">
              Principal bindings
            </h3>
            {bindings.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                No principal bindings
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-0.5 text-sm text-slate-700 dark:text-slate-300">
                {bindings.map((binding) => (
                  <li key={`${binding.principalId}-${binding.role}`}>
                    {binding.displayName} · {binding.type} · {binding.role} ·{' '}
                    {binding.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </section>

      <section
        aria-labelledby="admin-history-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="admin-history-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Telemetry history ({history.length})
        </h2>
        {history.length === 0 ? (
          <EmptyState
            title="No records"
            description="Telemetry history for this vehicle will appear here."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {history.map((row) => {
              const rowBadge = agentVerificationBadge(row.verificationStatus);
              const paymentTx = row.paymentTransactionHash;
              const isPaid = paymentTx !== null;

              return (
                <li key={row.id}>
                  <Card>
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-sm">
                        {formatTimestamp(row.recordedAt)}
                      </CardTitle>
                      <StatusBadge tone={rowBadge.tone}>
                        {rowBadge.label}
                      </StatusBadge>
                      <StatusBadge tone="neutral">
                        {row.anchorStatus}
                      </StatusBadge>
                      {isPaid ? (
                        <StatusBadge tone="success">Settled</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Unpaid</StatusBadge>
                      )}
                    </div>
                    <CardDescription className="mt-1 font-mono text-xs break-all">
                      {truncateHash(row.contentHash, 14, 8)} · id {row.id}
                    </CardDescription>

                    <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                      {readTelemetryReadingFields(row.telemetryPayload).map(
                        (field) => (
                          <DetailField
                            key={field.label}
                            label={field.label}
                            value={field.value}
                          />
                        ),
                      )}
                    </dl>

                    <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-200 pt-3 text-sm sm:grid-cols-2 dark:border-slate-700">
                      <div className="sm:col-span-2">
                        <DeviceEventTransactionLink
                          transactionHash={row.anchorTransactionHash}
                        />
                      </div>
                      {paymentTx !== null ? (
                        <div className="sm:col-span-2">
                          <SettlementPaymentRef
                            settlementRef={paymentTx}
                            compact
                          />
                        </div>
                      ) : (
                        <p className="text-xs text-slate-600 sm:col-span-2 dark:text-slate-400">
                          No settlement payment recorded for this row yet.
                          Readings are still shown for admin inspection.
                        </p>
                      )}
                    </dl>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'mt-0.5 font-mono text-xs break-all text-slate-800 dark:text-slate-200'
            : 'mt-0.5 text-slate-800 dark:text-slate-200'
        }
      >
        {value}
      </dd>
    </div>
  );
}
