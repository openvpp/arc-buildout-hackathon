import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { Card } from '@/components/ui/card';
import { SignInPrompt } from '@/features/unlocks/sign-in-prompt';
import { formatUsdcAtomic } from '@/lib/payments/usdc';
import { getUserOverview } from '@/server/application/unlocks/list-unlocks';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { getDb } from '@/server/infrastructure/db/client';
import { resolvePaymentConfig } from '@/server/infrastructure/payments/payment-config';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your devices, on-chain records and unlocks.',
};
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function Metric({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-white/50 uppercase">
        {label}
      </span>
      <span className="text-2xl font-semibold text-white tabular-nums">
        {value}
      </span>
      <span className="text-xs text-white/50">{hint}</span>
    </Card>
  );
}

export default async function DashboardPage() {
  const principal = await getCurrentPrincipal();
  if (principal === null) {
    return (
      <SignInPrompt
        title="Dashboard"
        description="Your devices, their on-chain records, and what you unlocked."
      />
    );
  }
  const overview = await getUserOverview(getDb(), {
    principalId: principal.principalId,
    walletId: principal.walletId,
  });
  const resolved = resolvePaymentConfig();
  const locked = Math.max(overview.anchoredEvents - overview.unlockedEvents, 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="Records are anchored on Arc and stay locked until you unlock them with a USDC nanopayment."
      />
      <section
        aria-label="Overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-3"
      >
        <Metric
          label="Devices"
          value={String(overview.devices)}
          hint={`${overview.minted} minted as DeviceNFTs`}
        />
        <Metric
          label="On-chain records"
          value={String(overview.anchoredEvents)}
          hint={`${overview.verifiedEvents} independently verified`}
        />
        <Metric
          label="Locked"
          value={String(locked)}
          hint="Anchored records you have not unlocked"
        />
        <Metric
          label="Unlocked"
          value={String(overview.unlockedEvents)}
          hint="Full record and proof revealed"
        />
        <Metric
          label="Spent"
          value={`${formatUsdcAtomic(overview.spentAtomic)} USDC`}
          hint="Paid by the demo wallet on Arc"
        />
        <Metric
          label="Price per unlock"
          value={
            resolved.ok
              ? `${formatUsdcAtomic(resolved.config.unlockPriceAtomic)} USDC`
              : '—'
          }
          hint={
            resolved.ok
              ? 'Circle Gateway nanopayment'
              : 'Unlocking is not set up here'
          }
        />
      </section>
      <div className="flex flex-wrap gap-4 text-sm text-primary-500">
        <Link href="/devices" className="underline">
          Go to devices
        </Link>
        <Link href="/payments" className="underline">
          See payments
        </Link>
      </div>
    </div>
  );
}
