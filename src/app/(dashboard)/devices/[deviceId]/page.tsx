import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { loadDeviceDetail } from '@/features/dashboard';
import {
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  mintStatusTone,
  readDeviceMetadata,
  truncateHash,
} from '@/features/devices';
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
  const loaded = await loadDeviceDetail(deviceId);
  if (!loaded.ok) {
    return { title: 'Vehicle' };
  }
  return {
    title: deviceDisplayName(loaded.detail.device),
    description: 'Vehicle details and telemetry record history.',
  };
}

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

export default async function DeviceDetailPage({ params }: PageProps) {
  const { deviceId } = await params;
  const loaded = await loadDeviceDetail(deviceId);

  if (!loaded.ok) {
    if (loaded.reason === 'not_found') {
      notFound();
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Vehicle"
          description="Vehicle details and telemetry history."
        />
        <EmptyState
          title="Unavailable"
          description="Could not load this vehicle right now."
        />
      </div>
    );
  }

  const { wallet, device, latest, verification, history } = loaded.detail;
  const meta = readDeviceMetadata(device.metadata);
  const agentBadge = agentVerificationBadge(verification?.status);
  const label = deviceDisplayName(device);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/devices"
          className="text-sm font-medium text-slate-600 underline decoration-2 underline-offset-4 dark:text-slate-400"
        >
          ← All devices
        </Link>
        <PageHeader
          title={label}
          description="Vehicle details and metadata-only telemetry history. Payloads stay locked until you unlock on the dashboard."
        />
      </div>

      <section
        aria-labelledby="vehicle-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="vehicle-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Vehicle
        </h2>
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={deviceStatusTone(device.status)}>
              {device.status}
            </StatusBadge>
            <StatusBadge tone={mintStatusTone(device.mintStatus)}>
              mint {device.mintStatus}
            </StatusBadge>
            <StatusBadge tone={agentBadge.tone}>{agentBadge.label}</StatusBadge>
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

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
            >
              Request & unlock on dashboard
            </Link>
          </div>
        </Card>
      </section>

      <section aria-labelledby="latest-heading" className="flex flex-col gap-3">
        <h2
          id="latest-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Latest telemetry (metadata)
        </h2>
        {latest === null ? (
          <EmptyState
            title="No telemetry yet"
            description="Ingest an Enode webhook or inject demo telemetry for this vehicle."
          />
        ) : (
          <Card>
            <CardTitle>Latest record</CardTitle>
            <CardDescription>
              Payload values are hidden here. Unlock on the dashboard to view EV
              readings after payment.
            </CardDescription>
            <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailField
                label="Recorded at"
                value={formatTimestamp(latest.recordedAt)}
                mono
              />
              <DetailField label="Anchor status" value={latest.anchorStatus} />
              <DetailField
                label="Content hash"
                value={latest.contentHash}
                mono
              />
              <DetailField label="Record ID" value={latest.id} mono />
              {latest.anchorTransactionHash !== null ? (
                <DetailField
                  label="Anchor tx"
                  value={latest.anchorTransactionHash}
                  mono
                />
              ) : null}
              {verification?.paymentTransactionHash !== undefined ? (
                <DetailField
                  label="Payment tx"
                  value={verification.paymentTransactionHash}
                  mono
                />
              ) : null}
            </dl>
          </Card>
        )}
      </section>

      <section
        aria-labelledby="history-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="history-heading"
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
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {history.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardTitle className="font-mono text-xs break-all">
                    {truncateHash(row.contentHash, 14, 8)}
                  </CardTitle>
                  <CardDescription>
                    <span className="flex flex-col gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone="neutral">
                          {row.anchorStatus}
                        </StatusBadge>
                      </span>
                      <span className="font-mono text-xs break-all">
                        {formatTimestamp(row.recordedAt)}
                      </span>
                      <span className="font-mono text-xs break-all text-slate-500">
                        id {row.id}
                      </span>
                      {row.anchorTransactionHash !== null ? (
                        <span className="font-mono text-xs break-all">
                          anchor{' '}
                          {truncateHash(row.anchorTransactionHash, 12, 6)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">
                          Not anchored
                        </span>
                      )}
                    </span>
                  </CardDescription>
                </Card>
              </li>
            ))}
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
