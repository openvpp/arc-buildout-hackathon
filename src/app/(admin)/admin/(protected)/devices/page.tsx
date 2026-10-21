import type { Metadata } from 'next';
import Link from 'next/link';

import { StatusBadge } from '@/components/ui/status-badge';
import { mintStatusTone } from '@/features/devices/format';
import { listAdminDevices } from '@/server/application/admin/admin-devices';
import { ApplicationError } from '@/server/application/application-error';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Admin devices' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function shorten(address: string): string {
  return address.length > 12
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
}

export default async function AdminDevicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const onlyWithRecords = params.records !== '0';
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
  let page;
  try {
    page = await listAdminDevices(getDb(), {
      onlyWithRecords,
      ...(cursor !== undefined ? { cursor } : {}),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    page = await listAdminDevices(getDb(), { onlyWithRecords });
  }
  const filterHref = (records: boolean) =>
    `/admin/devices?records=${records ? '1' : '0'}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">Devices</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every device across all wallets, with its on-chain records and
            verification.
          </p>
        </div>
        <div className="flex gap-1 text-xs">
          {[
            { on: true, label: 'With records' },
            { on: false, label: 'All devices' },
          ].map((option) => (
            <Link
              key={option.label}
              href={filterHref(option.on)}
              aria-current={onlyWithRecords === option.on ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 ${
                onlyWithRecords === option.on
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:bg-slate-900'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </div>

      {page.devices.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          {onlyWithRecords
            ? 'No device has on-chain records yet.'
            : 'No devices yet.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-900 text-xs tracking-wide text-slate-400 uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Device
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Owner
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Mint
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Records
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Verification
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {page.devices.map((device) => (
                <tr key={device.id} className="hover:bg-slate-900/60">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/devices/${device.id}`}
                      className="font-medium text-white underline-offset-4 hover:underline"
                    >
                      {device.displayName ??
                        ([device.vendor, device.model]
                          .filter(Boolean)
                          .join(' ') ||
                          'Vehicle')}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {[device.vendor, device.model]
                        .filter(Boolean)
                        .join(' · ')}
                      {device.city !== null ? ` · ${device.city}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300">
                    <div>
                      {device.ownerAccount?.replace(/^circle:/, '') ?? '—'}
                    </div>
                    <div className="font-mono text-slate-500">
                      {shorten(device.ownerWallet)}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge tone={mintStatusTone(device.mintStatus)}>
                      {device.mintStatus}
                    </StatusBadge>
                    {device.tokenId !== null ? (
                      <div className="mt-1 text-xs text-slate-500">
                        token {device.tokenId}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-300 tabular-nums">
                    {device.records.anchored}/{device.records.total} anchored
                    {device.records.lastAt !== null ? (
                      <div className="text-slate-500">
                        last {device.records.lastAt.toISOString().slice(0, 10)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    <span className="text-primary-400">
                      {device.records.verified} ✓
                    </span>
                    {device.records.warnings > 0 ? (
                      <span className="ml-2 text-amber-300">
                        {device.records.warnings} !
                      </span>
                    ) : null}
                    {device.records.unverified > 0 ? (
                      <span className="ml-2 text-red-400">
                        {device.records.unverified} ✕
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-4 text-sm">
        {cursor !== undefined ? (
          <Link
            href={filterHref(onlyWithRecords)}
            className="text-primary-500 underline"
          >
            Newest
          </Link>
        ) : null}
        {page.nextCursor !== null ? (
          <Link
            href={`${filterHref(onlyWithRecords)}&cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-primary-500 underline"
          >
            Older devices
          </Link>
        ) : null}
      </div>
    </div>
  );
}
