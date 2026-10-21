import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { StatusBadge } from '@/components/ui/status-badge';
import { AdminActionButton } from '@/features/admin/action-button';
import {
  syncDeviceFromChainAction,
  verifyDeviceAction,
  verifyRecordAction,
} from '@/features/admin/actions';
import { mintStatusTone } from '@/features/devices/format';
import { TransactionLink } from '@/features/devices/transaction-link';
import {
  VerdictBadge,
  VerificationReport,
} from '@/features/verification/verification-report';
import {
  getAdminDeviceDetail,
  type ReconciledRecord,
} from '@/server/application/admin/admin-device-detail';
import { summarizeDeviceEvent } from '@/server/application/dashboard/list-device-events';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Admin device' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const KIND_META: Record<
  ReconciledRecord['kind'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  matched: { label: 'On-chain · matched', tone: 'success' },
  anchored_not_indexed: {
    label: 'Anchored · not yet indexed',
    tone: 'neutral',
  },
  missing_on_chain: { label: 'Missing on-chain', tone: 'warning' },
  on_chain_only: {
    label: 'On-chain only · no off-chain record',
    tone: 'danger',
  },
};

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        {label}
      </dt>
      <dd
        className={`text-sm break-all text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

function recordTitle(
  eventType: number,
  payloadJson: string,
  sourceType: string,
): string {
  const summary = summarizeDeviceEvent(sourceType, payloadJson);
  if (summary?.kind === 'charging_completed') {
    return `Charging · ${summary.energyDeliveredKwh.toFixed(1)} kWh (estimated) · ${summary.startTime.slice(0, 16).replace('T', ' ')} UTC`;
  }
  if (summary?.kind === 'daily_odometer') {
    return `Daily mileage · ${summary.distanceMiles.toFixed(1)} mi · ${summary.startTime.slice(0, 10)}`;
  }
  return `Device event type ${eventType}`;
}

export default async function AdminDeviceDetailPage({
  params,
}: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await params;
  if (!z.string().uuid().safeParse(deviceId).success) {
    notFound();
  }
  const detail = await getAdminDeviceDetail(getDb(), deviceId);
  if (detail === null) {
    notFound();
  }
  const { device, address, summary, completeness } = detail;
  const name =
    device.displayName ??
    ([device.vendor, device.model].filter(Boolean).join(' ') || 'Vehicle');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/admin/devices"
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            ← Devices
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-white">{name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge tone={mintStatusTone(detail.displayMintStatus)}>
              {detail.displayMintStatus}
            </StatusBadge>
            <StatusBadge
              tone={device.status === 'active' ? 'success' : 'neutral'}
            >
              {device.status}
            </StatusBadge>
            <TransactionLink transactionHash={device.nftTransactionHash} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminActionButton
            action={verifyDeviceAction}
            fields={{ deviceId: device.id }}
            label="Verify all records"
            pendingLabel="Verifying…"
            variant="primary"
          />
          <AdminActionButton
            action={syncDeviceFromChainAction}
            fields={{ deviceId: device.id }}
            label="Sync from chain"
            pendingLabel="Syncing…"
          />
        </div>
      </div>

      <section
        aria-labelledby="identity"
        className="rounded-md border border-slate-800 bg-slate-900 p-4"
      >
        <h2 id="identity" className="mb-3 text-sm font-medium text-slate-300">
          Identity &amp; ownership
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Device id" value={device.id} mono />
          <Field
            label="Provider vehicle id"
            value={`${device.provider} · ${device.externalDeviceId}`}
            mono
          />
          <Field label="DeviceNFT token" value={device.nftTokenId} />
          <Field
            label="Owner account"
            value={detail.owner.account?.replace(/^circle:/, '') ?? null}
          />
          <Field label="Owner wallet" value={detail.owner.wallet} mono />
          <Field label="Contract" value={detail.chain.contractAddress} mono />
        </dl>
      </section>

      <section
        aria-labelledby="location"
        className="rounded-md border border-slate-800 bg-slate-900 p-4"
      >
        <h2 id="location" className="mb-3 text-sm font-medium text-slate-300">
          Address &amp; location{' '}
          <span className="text-xs font-normal text-slate-500">
            (admin only)
          </span>
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Registered address"
            value={
              address === null
                ? null
                : `${address.formattedAddress}${address.unit !== null ? ` · ${address.unit}` : ''}`
            }
          />
          <Field
            label="Exact point"
            value={
              address === null
                ? null
                : `${address.latitude}, ${address.longitude}`
            }
            mono
          />
          <Field
            label="Public globe point (0.5–2 km away)"
            value={
              address === null
                ? null
                : `${address.publicLatitude}, ${address.publicLongitude}`
            }
            mono
          />
          <Field
            label="Last live location"
            value={
              device.lastLatitude === null || device.lastLongitude === null
                ? null
                : `${device.lastLatitude}, ${device.lastLongitude}`
            }
            mono
          />
          <Field
            label="Last seen"
            value={device.lastSeenAt?.toUTCString() ?? null}
          />
        </dl>
      </section>

      <section aria-labelledby="mv" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mv" className="text-sm font-medium text-slate-300">
            On-chain telemetry &amp; verification
          </h2>
          <p className="text-xs text-slate-500">
            Chain index through block{' '}
            {detail.chain.indexedThroughBlock ?? '— (scanner not run yet)'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <span className="text-primary-400 tabular-nums">
              {summary.matched}
            </span>{' '}
            matched on-chain
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <span className="tabular-nums">{summary.anchoredNotIndexed}</span>{' '}
            anchored, not indexed
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <span className="text-amber-300 tabular-nums">
              {summary.missingOnChain}
            </span>{' '}
            missing on-chain
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-900 p-3">
            <span
              className={`tabular-nums ${summary.onChainOnly > 0 ? 'text-red-400' : ''}`}
            >
              {summary.onChainOnly}
            </span>{' '}
            on-chain only
          </div>
        </div>
        <p
          className={`text-xs ${completeness.gaps.length > 0 ? 'text-amber-300' : 'text-slate-500'}`}
        >
          Daily series: {completeness.daysWithReadings} day(s) with readings;{' '}
          {completeness.gaps.length === 0
            ? 'no gaps.'
            : `${completeness.gaps.length} gap(s): ${completeness.gaps.slice(0, 10).join(', ')}${completeness.gaps.length > 10 ? '…' : ''}`}
        </p>

        {detail.reconciled.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
            No telemetry records on- or off-chain for this device yet.
          </div>
        ) : (
          <ol className="flex flex-col gap-2">
            {detail.reconciled.map((entry) => {
              const meta = KIND_META[entry.kind];
              if (entry.kind === 'on_chain_only') {
                return (
                  <li
                    key={`chain-${entry.chain.id}`}
                    className="rounded-md border border-red-900/60 bg-slate-900 p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      <span className="text-slate-300">
                        event type {entry.chain.eventType} · block{' '}
                        {entry.chain.blockNumber.toString()}
                      </span>
                      <TransactionLink
                        transactionHash={entry.chain.transactionHash}
                      />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Anchored for this token but not recorded by this app
                      (another writer, or a record that was deleted). Not
                      vouched for.
                    </p>
                    {entry.chain.payloadUtf8 !== null ? (
                      <p className="mt-1 font-mono text-xs break-all text-slate-400">
                        {entry.chain.payloadUtf8}
                      </p>
                    ) : null}
                  </li>
                );
              }
              const { record, verification } = entry;
              return (
                <li
                  key={record.id}
                  className="rounded-md border border-slate-800 bg-slate-900 p-3"
                >
                  <details>
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm">
                      <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      {record.status === 'confirmed' ? (
                        <VerdictBadge verdict={record.verificationStatus} />
                      ) : null}
                      <span className="text-slate-200">
                        {recordTitle(
                          record.eventType,
                          record.payloadJson,
                          record.sourceType,
                        )}
                      </span>
                      <span className="text-xs text-slate-500">
                        · publish {record.status}
                      </span>
                    </summary>
                    <div className="mt-3 flex flex-col gap-3 border-t border-slate-800 pt-3">
                      <VerificationReport
                        verdict={verification?.verdict ?? null}
                        checks={verification?.checks ?? []}
                        checkedAt={
                          verification?.checkedAt.toISOString() ?? null
                        }
                        checkedBy={verification?.checkedBy ?? null}
                        transactionHash={record.transactionHash}
                        blockNumber={record.blockNumber?.toString() ?? null}
                        payloadJson={record.payloadJson}
                        payloadHash={record.payloadHash}
                        payloadVersion={record.payloadVersion}
                        privateRecord={
                          record.recordJson !== null &&
                          record.recordSalt !== null
                            ? {
                                recordJson: record.recordJson,
                                recordSalt: record.recordSalt,
                              }
                            : null
                        }
                      />
                      {record.status === 'confirmed' ? (
                        <div className="flex flex-wrap items-start gap-3">
                          <AdminActionButton
                            action={verifyRecordAction}
                            fields={{
                              deviceEventId: record.id,
                              deviceId: device.id,
                            }}
                            label="Verify now"
                            pendingLabel="Reading chain…"
                          />
                          {record.transactionHash !== null ? (
                            <Link
                              href={`/verify/${record.transactionHash}`}
                              className="pt-1.5 text-xs text-slate-400 underline"
                            >
                              Public verification page
                            </Link>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
