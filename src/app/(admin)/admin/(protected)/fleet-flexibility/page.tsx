import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  AdminHomeMetricCard,
  AdminUnavailableState,
  formatKilowattHours,
  headroomUnavailableLabel,
  summarizeFleetFlexibility,
  type FleetFlexibilityVehicle,
} from '@/features/admin';
import { loadAdminSnapshot } from '@/features/admin/server';
import { deviceDisplayName } from '@/features/devices';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Fleet flexibility',
  description:
    'Demo view of fleet charge headroom — unused battery space the grid could still fill, from verified EV telemetry.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function readingTrustBadge(vehicle: FleetFlexibilityVehicle): {
  tone: 'success' | 'warning' | 'neutral';
  label: string;
} {
  if (vehicle.hasVerifiedReading) {
    return { tone: 'success', label: 'Verified' };
  }
  if (
    vehicle.stateOfChargePercent !== null ||
    vehicle.batteryCapacityKilowattHours !== null
  ) {
    return { tone: 'warning', label: 'Latest unlocked' };
  }
  return { tone: 'neutral', label: 'No reading' };
}

export default async function AdminFleetFlexibilityPage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return (
      <AdminUnavailableState title="Fleet flexibility" reason={loaded.reason} />
    );
  }

  const flexibility = summarizeFleetFlexibility(
    loaded.snapshot,
    deviceDisplayName,
    shortenAddress,
  );
  const vehicleCount = flexibility.vehicles.length;

  return (
    <div className="flex flex-col gap-6">
      <div className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-sky-50 px-5 py-6 dark:border-slate-800 dark:from-emerald-950/40 dark:via-slate-950 dark:to-sky-950/30">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-8 h-44 w-44 rounded-full bg-sky-200/40 blur-3xl dark:bg-sky-500/10"
        />
        <div className="relative flex flex-col gap-4">
          <PageHeader
            title="Fleet flexibility"
            description="A hackathon demo view of how paid, independently checked EV telemetry becomes a usable grid signal: how much battery space is still empty across the connected fleet."
          />
          <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Grid operators care about{' '}
            <span className="font-medium text-slate-800 dark:text-slate-200">
              charge flexibility
            </span>
            — energy they can still ask EVs to absorb when supply is high. This
            page turns each vehicle’s state of charge (SoC) and pack size into
            that remaining capacity (“headroom”), then sums it for the fleet.
          </p>
        </div>
      </div>

      <section
        aria-labelledby="fleet-flexibility-metrics-heading"
        className="flex flex-col gap-3"
      >
        <h2
          id="fleet-flexibility-metrics-heading"
          className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300"
        >
          Snapshot
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <AdminHomeMetricCard
            tone="lime"
            title="Total fleet headroom"
            value={formatKilowattHours(flexibility.totalHeadroomKilowattHours)}
            meta="Unused pack capacity the grid could still fill"
          />
          <AdminHomeMetricCard
            tone="sky"
            title="Vehicles counted"
            value={`${flexibility.includedVehicleCount} / ${vehicleCount}`}
            meta="Included only when SoC and capacity are both present"
          />
          <AdminHomeMetricCard
            tone="emerald"
            title="Verified readings"
            value={`${flexibility.verifiedVehicleCount} / ${vehicleCount}`}
            meta="Prefer agent-verified telemetry; else latest unlocked"
          />
        </div>
      </section>

      <section
        aria-labelledby="fleet-flexibility-how-heading"
        className="rounded-xl border border-slate-200 bg-slate-50/80 px-5 py-5 dark:border-slate-800 dark:bg-slate-900/40"
      >
        <h2
          id="fleet-flexibility-how-heading"
          className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300"
        >
          How to read this
        </h2>
        <ol className="mt-4 grid gap-4 text-sm text-slate-600 md:grid-cols-3 dark:text-slate-400">
          <li className="flex flex-col gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              1. What it answers
            </span>
            <span>
              “If every connected EV charged now, how many more kilowatt-hours
              could the fleet take?” That leftover room is charge headroom.
            </span>
          </li>
          <li className="flex flex-col gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              2. The formula
            </span>
            <span>
              Per vehicle:{' '}
              <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-950 dark:text-slate-200">
                headroom = (1 − SoC) × pack kWh
              </code>
              . Example: 10% SoC on a 75 kWh pack → 67.5 kWh headroom.
            </span>
          </li>
          <li className="flex flex-col gap-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              3. Trust source
            </span>
            <span>
              We prefer an independently{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Verified
              </span>{' '}
              reading (paid nanopayment + Arc check). If none exists yet, we
              fall back to the latest unlocked payload and flag it.
            </span>
          </li>
        </ol>
      </section>

      {flexibility.vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles"
          description="Connect devices to estimate fleet charge headroom from live telemetry."
        />
      ) : (
        <section
          aria-labelledby="fleet-flexibility-table-heading"
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <h2
              id="fleet-flexibility-table-heading"
              className="text-sm font-semibold tracking-wide text-slate-700 uppercase dark:text-slate-300"
            >
              Per-vehicle headroom
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Totals exclude vehicles missing SoC or pack capacity
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-600 uppercase dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Wallet</th>
                  <th className="px-3 py-2 font-medium">SoC</th>
                  <th className="px-3 py-2 font-medium">Capacity</th>
                  <th className="px-3 py-2 font-medium">Headroom</th>
                  <th className="px-3 py-2 font-medium">Reading</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {flexibility.vehicles.map((vehicle) => {
                  const trust = readingTrustBadge(vehicle);
                  return (
                    <tr key={vehicle.deviceId}>
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/devices/${vehicle.deviceId}`}
                          className="font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
                        >
                          {vehicle.label}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                        {vehicle.walletLabel}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {vehicle.stateOfChargePercent === null
                          ? '—'
                          : `${vehicle.stateOfChargePercent}%`}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                        {vehicle.batteryCapacityKilowattHours === null
                          ? '—'
                          : formatKilowattHours(
                              vehicle.batteryCapacityKilowattHours,
                            )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">
                        {vehicle.headroom.ok
                          ? formatKilowattHours(
                              vehicle.headroom.headroomKilowattHours,
                            )
                          : headroomUnavailableLabel(vehicle)}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge tone={trust.tone}>
                          {trust.label}
                        </StatusBadge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
                <tr>
                  <td
                    colSpan={4}
                    className="px-3 py-2 text-xs font-semibold tracking-wide text-slate-600 uppercase dark:text-slate-400"
                  >
                    Total fleet headroom
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {formatKilowattHours(
                      flexibility.totalHeadroomKilowattHours,
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {flexibility.includedVehicleCount} vehicle
                    {flexibility.includedVehicleCount === 1 ? '' : 's'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
