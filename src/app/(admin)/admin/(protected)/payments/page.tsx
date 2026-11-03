import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';

import { DepositForm } from '@/features/admin/deposit-form';
import { AdminMetricCard } from '@/features/admin/metric-card';
import { formatTimestamp, truncateHash } from '@/features/devices/format';
import { SettlementBadge } from '@/features/unlocks/settlement-badge';
import { formatUsdcAtomic } from '@/lib/payments/usdc';
import {
  getPaymentTotals,
  listAdminPayments,
} from '@/server/application/admin/admin-payments';
import { ApplicationError } from '@/server/application/application-error';
import { staticPayerSpentToday } from '@/server/application/unlocks/event-unlock';
import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';
import type { GatewayBalances } from '@/server/infrastructure/payments/gateway';
import {
  createConfiguredBalanceReader,
  createStaticPayer,
  resolvePaymentConfig,
} from '@/server/infrastructure/payments/payment-config';

export const metadata: Metadata = { title: 'Admin payments' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const log = createServerLogger({ component: 'admin-payments-page' });
const cursorSchema = z.string().min(1).max(512);

const BUYER_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  agent: 'Agent',
};

async function balancesOrNull(
  read: () => Promise<GatewayBalances>,
): Promise<GatewayBalances | null> {
  try {
    return await read();
  } catch (error) {
    log.warn('admin.payments_balance_unavailable', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function usdc(atomic: bigint | null): string {
  return atomic === null ? 'unavailable' : `${formatUsdcAtomic(atomic)} USDC`;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = getDb();
  const cursorParam = cursorSchema.safeParse((await searchParams).cursor);
  let page;
  try {
    page = await listAdminPayments(
      db,
      cursorParam.success ? { cursor: cursorParam.data } : {},
    );
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    page = await listAdminPayments(db, {});
  }
  const totals = await getPaymentTotals(db);
  const resolved = resolvePaymentConfig();
  const payer = resolved.ok ? createStaticPayer(resolved.config.network) : null;
  const readBalance = resolved.ok
    ? createConfiguredBalanceReader(resolved.config.network)
    : null;
  const [payerBalances, sellerBalances, spentToday] = await Promise.all([
    payer === null
      ? Promise.resolve(null)
      : balancesOrNull(() => payer.getBalances()),
    // The seller has no key here: read its balance from Gateway directly.
    readBalance === null || !resolved.ok
      ? Promise.resolve(null)
      : balancesOrNull(async () => ({
          walletAtomic: 0n,
          gatewayAvailableAtomic: await readBalance(
            resolved.config.sellerAddress,
          ),
        })),
    payer === null
      ? Promise.resolve(0n)
      : staticPayerSpentToday(db, payer.address),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Payments</h1>
        <p className="mt-1 text-sm text-slate-400">
          Every unlock is a USDC nanopayment through Circle Gateway (x402):
          accepted at once, settled on Arc in Gateway&apos;s next batch.
        </p>
      </div>

      <section aria-labelledby="totals" className="flex flex-col gap-3">
        <h2 id="totals" className="text-sm font-medium text-slate-300">
          Totals
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <AdminMetricCard label="Unlocks" value={totals.count} />
          <AdminMetricCard
            label="Revenue (USDC)"
            value={formatUsdcAtomic(totals.revenueAtomic)}
          />
          <AdminMetricCard
            label="Settled (USDC)"
            value={formatUsdcAtomic(totals.settledAtomic)}
          />
          <AdminMetricCard
            label="Awaiting settlement"
            value={totals.acceptedCount}
          />
        </div>
        <p className="text-xs text-slate-500">
          By buyer: {totals.byBuyer.owner} owner · {totals.byBuyer.admin} admin
          · {totals.byBuyer.agent} agent
        </p>
      </section>

      <section
        aria-labelledby="wallets"
        className="grid grid-cols-1 gap-3 md:grid-cols-2"
      >
        <h2 id="wallets" className="sr-only">
          Wallets
        </h2>
        <div className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-900 p-4 text-sm">
          <h3 className="font-medium text-slate-200">Static demo payer</h3>
          {payer === null ? (
            <p className="text-xs text-slate-400">
              Not configured (ARC_PAYMENT_SIGNER_PRIVATE_KEY), or this is
              production.
            </p>
          ) : (
            <>
              <p className="font-mono text-xs break-all text-slate-400">
                {payer.address}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">In Gateway</dt>
                  <dd className="text-slate-100">
                    {usdc(payerBalances?.gatewayAvailableAtomic ?? null)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">In wallet</dt>
                  <dd className="text-slate-100">
                    {usdc(payerBalances?.walletAtomic ?? null)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Spent today (UTC)</dt>
                  <dd className="text-slate-100">{usdc(spentToday)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Daily cap</dt>
                  <dd className="text-slate-100">
                    {resolved.ok
                      ? usdc(resolved.config.staticPayerDailyCapAtomic)
                      : '—'}
                  </dd>
                </div>
              </dl>
              <DepositForm payerAddress={payer.address} />
            </>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-slate-800 bg-slate-900 p-4 text-sm">
          <h3 className="font-medium text-slate-200">
            Seller (receives every unlock)
          </h3>
          {!resolved.ok ? (
            <p className="text-xs text-slate-400">
              Not configured (SELLER_WALLET_ADDRESS).
            </p>
          ) : (
            <>
              <p className="font-mono text-xs break-all text-slate-400">
                {resolved.config.sellerAddress}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-slate-500">In Gateway</dt>
                  <dd className="text-slate-100">
                    {usdc(sellerBalances?.gatewayAvailableAtomic ?? null)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Network</dt>
                  <dd className="text-slate-100">
                    {resolved.config.network.caip2}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Price per unlock</dt>
                  <dd className="text-slate-100">
                    {usdc(resolved.config.unlockPriceAtomic)}
                  </dd>
                </div>
              </dl>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="list" className="flex flex-col gap-3">
        <h2 id="list" className="text-sm font-medium text-slate-300">
          Unlocks
        </h2>
        {page.payments.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
            No unlocks yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-800">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900 text-xs tracking-wide text-slate-400 uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">When</th>
                  <th className="px-3 py-2 font-medium">Buyer</th>
                  <th className="px-3 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Paid by</th>
                  <th className="px-3 py-2 font-medium">Settlement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {page.payments.map((row) => (
                  <tr key={row.unlock.id}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap text-slate-300">
                      {formatTimestamp(row.unlock.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-200">
                      {BUYER_LABEL[row.unlock.buyerKind] ??
                        row.unlock.buyerKind}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/devices/${row.deviceId}`}
                        className="text-slate-200 underline"
                      >
                        {row.deviceName ??
                          ([row.vendor, row.model].filter(Boolean).join(' ') ||
                            'Vehicle')}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-100">
                      {formatUsdcAtomic(row.unlock.amountAtomic)} USDC
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">
                      {truncateHash(row.unlock.payerAddress)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <SettlementBadge
                          status={row.unlock.settlementStatus}
                          settlementTxHash={row.unlock.settlementTxHash}
                        />
                        <span className="font-mono text-[11px] text-slate-500">
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
            href={`/admin/payments?cursor=${encodeURIComponent(page.nextCursor)}`}
            className="text-sm text-slate-300 underline"
          >
            Older payments
          </Link>
        ) : null}
      </section>
    </div>
  );
}
