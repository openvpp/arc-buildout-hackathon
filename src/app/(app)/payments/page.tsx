import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { formatTimestamp, truncateHash } from '@/features/devices/format';
import { SettlementBadge } from '@/features/unlocks/settlement-badge';
import { SignInPrompt } from '@/features/unlocks/sign-in-prompt';
import { formatUsdcAtomic } from '@/lib/payments/usdc';
import { ApplicationError } from '@/server/application/application-error';
import { listUnlocksForPrincipal } from '@/server/application/unlocks/list-unlocks';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = {
  title: 'Payments',
  description: 'Events you unlocked and what each cost.',
};
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cursorSchema = z.string().min(1).max(512);

const EVENT_LABEL: Record<number, string> = {
  2: 'Charging session',
  12: 'Daily mileage',
};

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await getCurrentPrincipal();
  if (principal === null) {
    return (
      <SignInPrompt
        title="Payments"
        description="Events you unlocked and what each cost."
      />
    );
  }
  const cursorParam = cursorSchema.safeParse((await searchParams).cursor);
  const db = getDb();
  let page;
  try {
    page = await listUnlocksForPrincipal(db, {
      principalId: principal.principalId,
      ...(cursorParam.success ? { cursor: cursorParam.data } : {}),
    });
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    // A malformed cursor in the URL shows the newest page.
    page = await listUnlocksForPrincipal(db, {
      principalId: principal.principalId,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Each unlock is a USDC nanopayment through Circle Gateway: accepted at once, settled on Arc in the next batch."
      />
      {page.unlocks.length === 0 ? (
        <EmptyState
          title="No unlocks yet"
          description="Open a device and unlock one of its on-chain records."
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-white/10">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs tracking-wide text-white/50 uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Record</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Settlement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {page.unlocks.map((row) => (
                <tr key={row.unlock.id}>
                  <td className="px-3 py-2 text-xs whitespace-nowrap text-white/70">
                    {formatTimestamp(row.unlock.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-white/90">
                    {EVENT_LABEL[row.eventType] ?? 'Device event'}
                    <span className="block text-xs text-white/50">
                      {formatTimestamp(row.occurredAt)}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/devices/${row.deviceId}`}
                      className="text-primary-500 underline"
                    >
                      {row.deviceName ??
                        ([row.vendor, row.model].filter(Boolean).join(' ') ||
                          'Vehicle')}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-white/90">
                    {formatUsdcAtomic(row.unlock.amountAtomic)} USDC
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <SettlementBadge
                        status={row.unlock.settlementStatus}
                        settlementTxHash={row.unlock.settlementTxHash}
                      />
                      <span className="font-mono text-[11px] text-white/40">
                        ref {truncateHash(row.unlock.settlementReference)}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page.nextCursor !== null ? (
        <Link
          href={`/payments?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="text-sm text-primary-500 underline"
        >
          Older payments
        </Link>
      ) : null}
    </div>
  );
}
