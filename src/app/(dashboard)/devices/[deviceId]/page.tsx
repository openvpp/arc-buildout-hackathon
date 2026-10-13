import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { PageContainer } from '@/components/layout/page-container';
import { Card } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DeviceEventTimeline } from '@/features/devices/device-event-timeline';
import { formatTimestamp, mintStatusTone } from '@/features/devices/format';
import { MintTransactionLink } from '@/features/devices/mint-transaction-link';
import { RefreshWhilePending } from '@/features/devices/refresh-while-pending';
import { AddressPrivacyNote } from '@/features/location/address-fields';
import { DeviceAddressEditor } from '@/features/location/device-address-editor';
import { ApplicationError } from '@/server/application/application-error';
import { getDeviceForWallet } from '@/server/application/dashboard/get-device';
import { getDeviceAddressForOwner } from '@/server/application/location/device-address';
import {
  listDeviceEventsForWallet,
  type DeviceEventPage,
} from '@/server/application/dashboard/list-device-events';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Device' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EVENTS_PAGE_SIZE = 20;

const eventsCursorSchema = z.string().min(1).max(512);

export default async function DeviceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { deviceId } = await params;
  const cursorParam = eventsCursorSchema.safeParse((await searchParams).events);
  const eventsCursor = cursorParam.success ? cursorParam.data : undefined;
  if (!z.string().uuid().safeParse(deviceId).success) {
    notFound();
  }
  const principal = await getCurrentPrincipal();

  if (principal === null) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-6">
          <PageHeader title="Device" />
          <EmptyState
            title="Sign in to continue"
            description="Sign in to view this device."
          />
        </div>
      </PageContainer>
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

  const address = await getDeviceAddressForOwner(db, {
    deviceId,
    walletId: principal.walletId,
  });

  let eventsPage: DeviceEventPage | null;
  try {
    eventsPage = await listDeviceEventsForWallet(db, {
      deviceId,
      walletId: principal.walletId,
      limit: EVENTS_PAGE_SIZE,
      ...(eventsCursor !== undefined ? { cursor: eventsCursor } : {}),
    });
  } catch (error) {
    // A malformed cursor in the URL just shows the newest page.
    if (!(error instanceof ApplicationError)) {
      throw error;
    }
    eventsPage = await listDeviceEventsForWallet(db, {
      deviceId,
      walletId: principal.walletId,
      limit: EVENTS_PAGE_SIZE,
    });
  }
  const events = eventsPage?.events ?? [];
  const deviceMinted =
    device.nftTokenId !== null && device.nftTokenId.length > 0;
  const devicePath = `/devices/${device.id}`;
  const eventInFlight = events.some(
    (event) =>
      event.status === 'pending' || (event.status === 'queued' && deviceMinted),
  );

  return (
    <PageContainer>
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
          <dl className="grid grid-cols-1 gap-3 text-sm text-white/80 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                External ID
              </dt>
              <dd className="font-mono break-all">{device.externalDeviceId}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Token ID
              </dt>
              <dd>{device.nftTokenId ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Network
              </dt>
              <dd>{device.network ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
                Last seen
              </dt>
              <dd>
                {device.lastSeenAt !== null
                  ? formatTimestamp(device.lastSeenAt)
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-white/60 uppercase">
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
        <Card className="flex flex-col gap-3" aria-labelledby="device-address">
          <h2 id="device-address" className="text-sm font-semibold text-white">
            Address
          </h2>
          {address !== null ? (
            <>
              <p className="text-sm text-white/90">
                {address.formattedAddress}
                {address.unit !== null ? ` · ${address.unit}` : ''}
              </p>
              <AddressPrivacyNote />
            </>
          ) : (
            <p className="text-sm text-white/70">
              Add the address where this vehicle is usually kept.
            </p>
          )}
          <DeviceAddressEditor
            deviceId={device.id}
            hasAddress={address !== null}
            currentUnit={address?.unit ?? null}
          />
        </Card>
        <DeviceEventTimeline
          events={events}
          deviceMinted={deviceMinted}
          olderHref={
            eventsPage !== null && eventsPage.nextCursor !== null
              ? `${devicePath}?events=${encodeURIComponent(eventsPage.nextCursor)}`
              : null
          }
          newestHref={eventsCursor !== undefined ? devicePath : null}
        />
        <RefreshWhilePending
          active={device.mintStatus === 'pending' || eventInFlight}
        />
        <div className="flex gap-4 text-sm text-primary-500">
          <Link href="/devices" className="underline">
            Back to devices
          </Link>
          <Link href="/" className="underline">
            View on globe
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
