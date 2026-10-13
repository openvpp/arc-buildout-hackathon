import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatTimestamp, mintStatusTone } from '@/features/devices/format';

type PublicDeviceDetailsModel = {
  displayName: string | null;
  vendor: string | null;
  model: string | null;
  deviceType: string;
  mintStatus: string;
};

type PublicChargingSessionDetails = {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  energyDeliveredKwh: number;
  energyMethod: string;
  totalCost: number | null;
  currency: string;
};

export function PublicDeviceDetails({
  device,
  sessions,
  olderHref,
  newestHref,
}: {
  device: PublicDeviceDetailsModel;
  sessions: readonly PublicChargingSessionDetails[];
  olderHref: string | null;
  newestHref: string | null;
}) {
  const title = device.displayName ?? device.model ?? 'Device';
  const description = [device.vendor, device.model]
    .filter((part) => part !== null && part.length > 0)
    .join(' · ');

  return (
    <PageContainer>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={title}
          {...(description.length > 0 ? { description } : {})}
        />
        <Card className="flex flex-col gap-3">
          <div className="self-start">
            <StatusBadge tone={mintStatusTone(device.mintStatus)}>
              {device.mintStatus}
            </StatusBadge>
          </div>
          <dl className="grid grid-cols-1 gap-3 text-sm text-white/80 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Type
              </dt>
              <dd>{deviceTypeLabel(device.deviceType)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Make
              </dt>
              <dd>{device.vendor ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Model
              </dt>
              <dd>{device.model ?? '—'}</dd>
            </div>
          </dl>
        </Card>
        <section
          className="flex flex-col gap-3"
          aria-labelledby="charging-sessions"
        >
          <h2
            id="charging-sessions"
            className="text-sm font-semibold text-white"
          >
            Charging sessions
          </h2>
          {sessions.length === 0 ? (
            <EmptyState
              title="No charging sessions"
              description="This vehicle has no completed charging sessions yet."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {sessions.map((session) => (
                <li key={session.id}>
                  <Card className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm text-white">
                        {formatTimestamp(session.startTime)}
                        {session.endTime !== null
                          ? ` – ${formatTimestamp(session.endTime)}`
                          : ''}
                      </p>
                      <StatusBadge tone="neutral">{session.status}</StatusBadge>
                    </div>
                    <p className="text-sm text-white/80">
                      {formatEnergy(session.energyDeliveredKwh)}
                      {' · '}
                      {energyMethodLabel(session.energyMethod)}
                    </p>
                    <p className="text-sm text-white/60">
                      Battery {formatBattery(session.startBatteryLevel)} to{' '}
                      {formatBattery(session.endBatteryLevel)}
                      {session.totalCost !== null
                        ? ` · ${formatMoney(session.totalCost, session.currency)}`
                        : ''}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {olderHref !== null || newestHref !== null ? (
            <div className="flex gap-4 text-sm text-primary-500">
              {newestHref !== null ? (
                <Link href={newestHref} className="underline">
                  Newer sessions
                </Link>
              ) : null}
              {olderHref !== null ? (
                <Link href={olderHref} className="underline">
                  Older sessions
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
        <Link href="/" className="text-sm text-primary-500 underline">
          Back to globe
        </Link>
      </div>
    </PageContainer>
  );
}

function deviceTypeLabel(deviceType: string): string {
  return deviceType
    .replace(/_/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

function formatEnergy(kwh: number): string {
  return `${kwh.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`;
}

function formatBattery(level: number | null): string {
  return level === null ? '—' : `${level.toFixed(0)}%`;
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

function energyMethodLabel(method: string): string {
  switch (method) {
    case 'direct_kwh':
      return 'Measured';
    case 'estimated_from_battery_change':
      return 'Estimated from battery change';
    default:
      return 'Energy source unknown';
  }
}
