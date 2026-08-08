import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ExternalLink } from '@/components/common/external-link';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { AdminUnavailableState, paymentStatusBadge } from '@/features/admin';
import { loadAdminSnapshot } from '@/features/admin/server';
import {
  arcTxExplorerUrl,
  formatTimestamp,
  isOnchainTxHash,
  truncateHash,
} from '@/features/devices';
import { shortenAddress } from '@/features/wallets';
import { ADMIN_PAYMENTS_LIMIT } from '@/server/application/admin/list-admin-payments';

export const metadata: Metadata = {
  title: 'Payments',
  description: 'Settled Circle Gateway nanopayments across tenants.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminPaymentsPage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return <AdminUnavailableState title="Payments" reason={loaded.reason} />;
  }

  const paymentCount = loaded.payments.length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description={
          paymentCount > 0
            ? `Settled Circle Gateway payments from payment_transactions (showing ${paymentCount}${paymentCount >= ADMIN_PAYMENTS_LIMIT ? '+' : ''} most recent).`
            : 'Settled Circle Gateway payments from payment_transactions after a paid telemetry delivery.'
        }
      />

      {loaded.payments.length === 0 ? (
        <EmptyState
          title="No payments yet"
          description="Payments appear here after an agent settles a 402 and the backend credits the ledger."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-600 uppercase dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Buyer</th>
                <th className="px-3 py-2 font-medium">Seller</th>
                <th className="px-3 py-2 font-medium">Settlement</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loaded.payments.map((payment) => {
                const status = paymentStatusBadge(payment.verificationStatus);
                const when = payment.verifiedAt ?? payment.createdAt;
                return (
                  <tr key={payment.id}>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {formatTimestamp(when)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">
                      {payment.amountDisplay} {payment.asset}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/devices/${payment.deviceId}`}
                        className="font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
                      >
                        {payment.deviceLabel}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                      {payment.fromAddress !== null
                        ? shortenAddress(payment.fromAddress)
                        : (payment.walletLabel ??
                          shortenAddress(payment.walletAddress))}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600 dark:text-slate-400">
                      {payment.toAddress !== null
                        ? shortenAddress(payment.toAddress)
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {isOnchainTxHash(payment.transactionHash) ? (
                        <ExternalLink
                          href={arcTxExplorerUrl(payment.transactionHash)}
                          className="font-mono text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
                        >
                          {truncateHash(payment.transactionHash)}
                        </ExternalLink>
                      ) : (
                        <span
                          className="font-mono text-xs break-all text-slate-700 dark:text-slate-300"
                          title={payment.transactionHash}
                        >
                          {truncateHash(payment.transactionHash)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge tone={status.tone}>
                        {status.label}
                      </StatusBadge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
