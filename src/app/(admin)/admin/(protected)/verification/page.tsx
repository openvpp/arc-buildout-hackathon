import type { Metadata } from 'next';
import Link from 'next/link';

import { VerdictBadge } from '@/features/verification/verification-report';
import {
  listAdminRecords,
  recordVerdictFilterSchema,
  type RecordVerdictFilter,
} from '@/server/application/admin/admin-records';
import { ApplicationError } from '@/server/application/application-error';
import { DEVICE_EVENT_TYPES } from '@/server/application/telemetry/device-event-payloads';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Admin verification' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FILTERS: { value: RecordVerdictFilter | undefined; label: string }[] = [
  { value: undefined, label: 'All anchored' },
  { value: 'verified', label: 'Verified' },
  { value: 'verified_with_warnings', label: 'Warnings' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'pending', label: 'Pending' },
  { value: 'unchecked', label: 'Not yet checked' },
];

export default async function AdminVerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const parsed = recordVerdictFilterSchema.safeParse(params.verdict);
  const verdict = parsed.success ? parsed.data : undefined;
  const cursor = typeof params.cursor === 'string' ? params.cursor : undefined;
  const hrefFor = (value: RecordVerdictFilter | undefined) =>
    value === undefined
      ? '/admin/verification'
      : `/admin/verification?verdict=${value}`;

  let page;
  try {
    page = await listAdminRecords(getDb(), {
      ...(verdict !== undefined ? { verdict } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    page = await listAdminRecords(
      getDb(),
      verdict !== undefined ? { verdict } : {},
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-white">Verification</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every anchored record and its latest independent verdict.
        </p>
      </div>
      <nav aria-label="Verdict filter" className="flex flex-wrap gap-1 text-xs">
        {FILTERS.map((filter) => (
          <Link
            key={filter.label}
            href={hrefFor(filter.value)}
            aria-current={verdict === filter.value ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 ${verdict === filter.value ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900'}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {page.records.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          No anchored records match this filter.
        </div>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
          {page.records.map((record) => (
            <li
              key={record.id}
              className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
            >
              <VerdictBadge verdict={record.verificationStatus} />
              <span className="text-slate-200">
                {record.eventType === DEVICE_EVENT_TYPES.CHARGING_COMPLETED
                  ? 'Charging'
                  : record.eventType === DEVICE_EVENT_TYPES.TRIP_COMPLETED
                    ? 'Daily mileage'
                    : `Type ${record.eventType}`}{' '}
                ·{' '}
                {record.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}{' '}
                UTC
              </span>
              <Link
                href={`/admin/devices/${record.deviceId}`}
                className="text-xs text-primary-500 underline"
              >
                {record.deviceName ?? record.vendor ?? 'Device'}
              </Link>
              <span className="ml-auto text-xs text-slate-500">
                v{record.payloadVersion}
                {record.lastVerifiedAt !== null
                  ? ` · checked ${record.lastVerifiedAt.toISOString().slice(0, 16).replace('T', ' ')}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-4 text-sm">
        {cursor !== undefined ? (
          <Link href={hrefFor(verdict)} className="text-primary-500 underline">
            Newest
          </Link>
        ) : null}
        {page.nextCursor !== null ? (
          <Link
            href={`${hrefFor(verdict)}${verdict === undefined ? '?' : '&'}cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-primary-500 underline"
          >
            Older records
          </Link>
        ) : null}
      </div>
    </div>
  );
}
