import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import {
  AdminUnavailableState,
  formatKilowattHours,
  headroomUnavailableLabel,
  summarizeFleetFlexibility,
} from '@/features/admin';
import { loadAdminSnapshot } from '@/features/admin/server';
import { deviceDisplayName } from '@/features/devices';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Fleet flexibility',
  description:
    'Fleet charge headroom from latest SoC and pack capacity (verified preferred).',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fleet flexibility"
        description="Energy the grid can still shift into the fleet from each vehicle’s latest SoC and pack capacity (independently verified reading preferred, otherwise latest unlocked): (1 − SoC) × kWh."
      />

      {flexibility.vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles"
          description="Connect devices to track fleet charge headroom."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-600 uppercase dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 font-medium">SoC</th>
                <th className="px-3 py-2 font-medium">Capacity</th>
                <th className="px-3 py-2 font-medium">Headroom</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {flexibility.vehicles.map((vehicle) => (
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
                </tr>
              ))}
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
                  {formatKilowattHours(flexibility.totalHeadroomKilowattHours)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
