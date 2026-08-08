import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  formatKilowattHours,
  loadAdminSnapshot,
  summarizeFleetFlexibility,
} from '@/features/admin';
import {
  DeviceMintTransactionLink,
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  truncateHash,
} from '@/features/devices';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Super Admin',
  description:
    'Cross-tenant view of wallets, devices, telemetry, and verification evidence.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function agentVerificationBadge(status: string | undefined): {
  tone: 'neutral' | 'success' | 'danger' | 'warning';
  label: string;
} {
  if (status === undefined) {
    return { tone: 'neutral', label: 'Not verified' };
  }
  if (status === 'VERIFIED') {
    return { tone: 'success', label: 'VERIFIED' };
  }
  if (status === 'PENDING_ONCHAIN') {
    return { tone: 'warning', label: 'Pending on Arc' };
  }
  return { tone: 'danger', label: status };
}

function headroomUnavailableLabel(
  vehicle: ReturnType<typeof summarizeFleetFlexibility>['vehicles'][number],
): string {
  if (!vehicle.hasVerifiedReading) {
    return 'No verified reading yet';
  }
  if (!vehicle.headroom.ok) {
    if (vehicle.headroom.reason === 'missing_soc') {
      return 'Missing SoC';
    }
    if (vehicle.headroom.reason === 'missing_capacity') {
      return 'Missing battery capacity';
    }
    return 'Invalid SoC';
  }
  return '—';
}

export default async function AdminPage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Super Admin"
          description="All bound wallets, devices, and telemetry across tenants."
        />
        <EmptyState
          title="No data"
          description={
            loaded.reason === 'no_bound_wallets'
              ? 'No wallets are bound to any principal yet.'
              : 'Nothing to show right now.'
          }
        />
      </div>
    );
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
  const flexibility = summarizeFleetFlexibility(
    loaded.snapshot,
    deviceDisplayName,
    shortenAddress,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Super Admin"
        description="Cross-tenant viewer for wallets, devices, and independently verified settlement evidence. Full unlocked telemetry is on each vehicle page."
      />

      <section
        aria-labelledby="admin-overview-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-overview-heading" className="sr-only">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <CardTitle>Wallets</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {walletCount}
              </span>{' '}
              bound
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {deviceCount}
              </span>{' '}
              connected
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Principals</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {principalCount}
              </span>{' '}
              bindings
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Verified latest</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {verifiedCount}
              </span>{' '}
              devices
            </CardDescription>
          </Card>
          <Card>
            <CardTitle>Fleet headroom</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {formatKilowattHours(flexibility.totalHeadroomKilowattHours)}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                from {flexibility.includedVehicleCount} of {deviceCount}{' '}
                vehicles with verified SoC + capacity
              </span>
            </CardDescription>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="admin-flexibility-heading"
        className="flex flex-col gap-3"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="admin-flexibility-heading"
            className="text-sm font-semibold text-slate-900 dark:text-slate-100"
          >
            Fleet flexibility — charge headroom
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Energy the grid can still shift into the fleet, from each vehicle’s
            latest independently verified SoC and pack capacity:{' '}
            <span className="font-mono">(1 − SoC) × kWh</span>.
          </p>
        </div>

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
                    {formatKilowattHours(
                      flexibility.totalHeadroomKilowattHours,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section
        aria-labelledby="admin-records-heading"
        className="flex flex-col gap-4"
      >
        <h2
          id="admin-records-heading"
          className="text-sm font-semibold text-slate-900 dark:text-slate-100"
        >
          Devices — all tenants
        </h2>

        {loaded.snapshot.length === 0 ? (
          <EmptyState
            title="No wallets yet"
            description="No bound wallets are available to inspect."
          />
        ) : (
          loaded.snapshot.map(({ wallet, bindings, devices }) => (
            <div key={wallet.id} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {wallet.label ?? shortenAddress(wallet.address)}
                </h3>
                <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-400">
                  {wallet.address}
                </p>
                <p className="text-xs text-slate-500">
                  chain {wallet.chainId.toString()} · {wallet.status}
                </p>
                {bindings.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-600 dark:text-slate-400">
                    {bindings.map((binding) => (
                      <li key={`${binding.principalId}-${binding.role}`}>
                        {binding.displayName} · {binding.type} · {binding.role}{' '}
                        · {binding.status}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">
                    No principal bindings
                  </p>
                )}
              </div>

              {devices.length === 0 ? (
                <EmptyState
                  title="No devices"
                  description="This wallet has no connected devices."
                />
              ) : (
                devices.map(({ device, latest, verification }) => {
                  const agentBadge = agentVerificationBadge(
                    verification?.status,
                  );
                  const label = deviceDisplayName(device);
                  const flexVehicle = flexibility.vehicles.find(
                    (v) => v.deviceId === device.id,
                  );
                  return (
                    <Card key={device.id}>
                      <CardTitle>{label}</CardTitle>
                      <CardDescription>
                        <span className="flex flex-col gap-2">
                          <span className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone="info">Unlocked</StatusBadge>
                            <StatusBadge tone={deviceStatusTone(device.status)}>
                              {device.status}
                            </StatusBadge>
                            <StatusBadge tone={agentBadge.tone}>
                              {agentBadge.label}
                            </StatusBadge>
                            <DeviceMintTransactionLink
                              nftTransactionHash={device.nftTransactionHash}
                              nftTokenId={device.nftTokenId}
                            />
                          </span>
                          <span>
                            {device.vendor ?? 'Unknown vendor'}
                            {device.model ? ` · ${device.model}` : ''}
                            {' · '}
                            <span className="font-mono text-xs">
                              {device.externalDeviceId}
                            </span>
                          </span>
                          <span>
                            Latest record:{' '}
                            {latest === null
                              ? 'none yet'
                              : `${formatTimestamp(latest.recordedAt)} · ${truncateHash(latest.contentHash, 10, 6)}`}
                          </span>
                          {latest !== null ? (
                            <span>
                              Device event: {latest.anchorStatus}
                              {verification?.paymentTransactionHash != null ? (
                                <>
                                  {' · '}
                                  payment{' '}
                                  <span className="font-mono text-xs">
                                    {truncateHash(
                                      verification.paymentTransactionHash,
                                      10,
                                      6,
                                    )}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          ) : null}
                          <span>
                            Charge headroom:{' '}
                            {flexVehicle?.headroom.ok
                              ? formatKilowattHours(
                                  flexVehicle.headroom.headroomKilowattHours,
                                )
                              : flexVehicle
                                ? headroomUnavailableLabel(flexVehicle)
                                : '—'}
                            {flexVehicle?.headroom.ok ? (
                              <span className="text-slate-500">
                                {' '}
                                ({flexVehicle.stateOfChargePercent}% of{' '}
                                {formatKilowattHours(
                                  flexVehicle.batteryCapacityKilowattHours ?? 0,
                                )}
                                )
                              </span>
                            ) : null}
                          </span>
                          <Link
                            href={`/admin/devices/${device.id}`}
                            className="w-fit font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
                          >
                            View vehicle & full telemetry
                          </Link>
                        </span>
                      </CardDescription>
                    </Card>
                  );
                })
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}
