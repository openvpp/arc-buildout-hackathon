import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

import { VerdictBadge } from '@/features/verification/verification-report';

import { formatTimestamp } from './format';
import { TransactionLink } from './transaction-link';

export type TimelineEventSummary =
  | {
      kind: 'charging_completed';
      startTime: string;
      endTime: string;
      energyDeliveredKwh: number;
      batteryLevel: number | null;
      totalCost: number | null;
      currency: string;
    }
  | {
      kind: 'daily_odometer';
      startTime: string;
      distanceMiles: number;
      startOdometerMiles: number;
      endOdometerMiles: number;
    };

export type TimelineEvent = {
  id: string;
  status: 'queued' | 'pending' | 'confirmed' | 'failed';
  transactionHash: string | null;
  blockNumber: string | null;
  payloadJson: string;
  payloadHash: string;
  summary: TimelineEventSummary | null;
  verificationStatus: string;
};

const STATUS_TONE = {
  queued: 'neutral',
  pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
} as const;

function statusLabel(event: TimelineEvent, deviceMinted: boolean): string {
  switch (event.status) {
    case 'confirmed':
      return 'On-chain';
    case 'pending':
      // Never imply success before the receipt confirms.
      return event.transactionHash === null ? 'Sending' : 'Confirming';
    case 'failed':
      return 'Failed';
    case 'queued':
      return deviceMinted ? 'Queued' : 'Waiting for mint';
  }
}

function formatUtcDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function EventHeadline({ summary }: { summary: TimelineEventSummary | null }) {
  if (summary === null) {
    return <CardTitle>Device event</CardTitle>;
  }
  if (summary.kind === 'charging_completed') {
    const details = [
      `${summary.energyDeliveredKwh.toFixed(1)} kWh (estimated)`,
      summary.totalCost !== null
        ? formatMoney(summary.totalCost, summary.currency)
        : null,
      summary.batteryLevel !== null
        ? `ended at ${Math.round(summary.batteryLevel)}%`
        : null,
    ].filter((part): part is string => part !== null);
    return (
      <div>
        <CardTitle>Charging session</CardTitle>
        <CardDescription>
          {formatTimestamp(new Date(summary.startTime))} →{' '}
          {formatTimestamp(new Date(summary.endTime))} · {details.join(' · ')}
        </CardDescription>
      </div>
    );
  }
  return (
    <div>
      <CardTitle>Daily mileage</CardTitle>
      <CardDescription>
        {formatUtcDay(summary.startTime)} (UTC) ·{' '}
        {summary.distanceMiles.toFixed(1)} mi · odometer{' '}
        {summary.endOdometerMiles.toLocaleString(undefined, {
          maximumFractionDigits: 1,
        })}{' '}
        mi
      </CardDescription>
    </div>
  );
}

/**
 * The device's on-chain time series. Status comes from the server (DB),
 * which only marks an event confirmed from a confirmed receipt.
 */
export function DeviceEventTimeline({
  events,
  deviceMinted,
  olderHref,
  newestHref,
}: {
  events: TimelineEvent[];
  deviceMinted: boolean;
  /** Link to the next (older) page, if any. */
  olderHref: string | null;
  /** Link back to the newest page when viewing an older one. */
  newestHref: string | null;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="device-events">
      <h2 id="device-events" className="text-sm font-semibold text-white">
        On-chain activity
      </h2>
      {events.length === 0 ? (
        <EmptyState
          title="No on-chain activity yet"
          description={
            deviceMinted
              ? 'Completed charging sessions and daily mileage appear here as they are recorded.'
              : 'Charging sessions and daily mileage are published once this device’s NFT is minted.'
          }
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id}>
              <Card className="flex flex-col gap-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <EventHeadline summary={event.summary} />
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={STATUS_TONE[event.status]}>
                      {statusLabel(event, deviceMinted)}
                    </StatusBadge>
                    <TransactionLink transactionHash={event.transactionHash} />
                    {event.status === 'confirmed' &&
                    event.transactionHash !== null ? (
                      <Link
                        href={`/verify/${event.transactionHash}`}
                        className="no-underline"
                        aria-label="Open the independent verification"
                      >
                        <VerdictBadge verdict={event.verificationStatus} />
                      </Link>
                    ) : null}
                  </div>
                </div>
                <details className="text-xs text-white/60">
                  <summary className="cursor-pointer select-none">
                    Published data
                  </summary>
                  <dl className="mt-2 flex flex-col gap-2">
                    <div>
                      <dt className="font-medium tracking-wide uppercase">
                        Payload (sent as event data)
                      </dt>
                      <dd className="font-mono break-all text-white/80">
                        {event.payloadJson}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium tracking-wide uppercase">
                        keccak256
                      </dt>
                      <dd className="font-mono break-all text-white/80">
                        {event.payloadHash}
                      </dd>
                    </div>
                    {event.blockNumber !== null ? (
                      <div>
                        <dt className="font-medium tracking-wide uppercase">
                          Block
                        </dt>
                        <dd className="font-mono text-white/80">
                          {event.blockNumber}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </details>
              </Card>
            </li>
          ))}
        </ol>
      )}
      {olderHref !== null || newestHref !== null ? (
        <nav className="flex gap-4 text-sm text-primary-500">
          {newestHref !== null ? (
            <Link href={newestHref} className="underline">
              Newest
            </Link>
          ) : null}
          {olderHref !== null ? (
            <Link href={olderHref} className="underline">
              Older activity
            </Link>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
