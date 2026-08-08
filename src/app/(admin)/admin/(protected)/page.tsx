import type { Metadata } from 'next';

import { PageHeader } from '@/components/common/page-header';
import {
  AdminHomeMetricCard,
  AdminUnavailableState,
  formatKilowattHours,
  summarizeFleetFlexibility,
} from '@/features/admin';
import { loadAdminSnapshot } from '@/features/admin/server';
import { deviceDisplayName } from '@/features/devices';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Super Admin',
  description:
    'Cross-tenant overview of wallets, devices, payments, and fleet headroom.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminHomePage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return <AdminUnavailableState title="Home" reason={loaded.reason} />;
  }

  const walletCount = loaded.snapshot.length;
  const deviceCount = loaded.snapshot.reduce(
    (sum, row) => sum + row.devices.length,
    0,
  );
  const verifiedCount = loaded.snapshot.reduce(
    (sum, row) =>
      sum +
      row.devices.filter((d) => d.verification?.status === 'VERIFIED').length,
    0,
  );
  const principalCount = loaded.snapshot.reduce(
    (sum, row) => sum + row.bindings.length,
    0,
  );
  const paymentCount = loaded.payments.length;
  const flexibility = summarizeFleetFlexibility(
    loaded.snapshot,
    deviceDisplayName,
    shortenAddress,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-emerald-50 px-5 py-6 dark:border-slate-800 dark:from-sky-950/40 dark:via-slate-950 dark:to-emerald-950/30">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-8 h-44 w-44 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/10"
        />
        <div className="relative">
          <PageHeader
            title="Home"
            description="Cross-tenant pulse for the demo. Jump into fleet flexibility, payments, or devices from here or the sidebar."
          />
        </div>
      </div>

      <section
        aria-labelledby="admin-overview-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex items-end justify-between gap-3">
          <h2
            id="admin-overview-heading"
            className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300"
          >
            Overview
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Live from Postgres · independently verified where noted
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <AdminHomeMetricCard
            tone="slate"
            title="Wallets"
            value={walletCount}
            meta="bound across tenants"
          />
          <AdminHomeMetricCard
            tone="sky"
            title="Devices"
            value={deviceCount}
            meta="connected EVs"
            href="/admin/devices"
            linkLabel="View devices →"
          />
          <AdminHomeMetricCard
            tone="cyan"
            title="Principals"
            value={principalCount}
            meta="wallet bindings"
          />
          <AdminHomeMetricCard
            tone="emerald"
            title="Verified latest"
            value={verifiedCount}
            meta="devices with independent VERIFIED evidence"
          />
          <AdminHomeMetricCard
            tone="amber"
            title="Payments"
            value={paymentCount}
            meta="recent settled nanopayments"
            href="/admin/payments"
            linkLabel="View payments →"
          />
          <AdminHomeMetricCard
            tone="lime"
            title="Fleet headroom"
            value={formatKilowattHours(flexibility.totalHeadroomKilowattHours)}
            meta={`from ${flexibility.includedVehicleCount} of ${deviceCount} vehicles with verified SoC + capacity`}
            href="/admin/fleet-flexibility"
            linkLabel="View fleet flexibility →"
          />
        </div>
      </section>
    </div>
  );
}
