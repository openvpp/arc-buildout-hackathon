import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  AdminUnavailableState,
  agentVerificationBadge,
  formatKilowattHours,
  headroomUnavailableLabel,
  summarizeFleetFlexibility,
} from '@/features/admin';
import { loadAdminSnapshot } from '@/features/admin/server';
import {
  DeviceMintTransactionLink,
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  truncateHash,
} from '@/features/devices';
import { shortenAddress } from '@/features/wallets';

export const metadata: Metadata = {
  title: 'Devices',
  description:
    'All tenants’ devices, latest telemetry, and verification evidence.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminDevicesPage() {
  const loaded = await loadAdminSnapshot();

  if (!loaded.ok) {
    return <AdminUnavailableState title="Devices" reason={loaded.reason} />;
  }

  const flexibility = summarizeFleetFlexibility(
    loaded.snapshot,
    deviceDisplayName,
    shortenAddress,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Devices"
        description="Cross-tenant devices. Open a vehicle for full unlocked telemetry history."
      />

      {loaded.snapshot.length === 0 ? (
        <EmptyState
          title="No wallets yet"
          description="No bound wallets are available to inspect."
        />
      ) : (
        loaded.snapshot.map(({ wallet, bindings, devices }) => (
          <section
            key={wallet.id}
            aria-labelledby={`wallet-${wallet.id}-heading`}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1">
              <h2
                id={`wallet-${wallet.id}-heading`}
                className="text-sm font-medium text-slate-800 dark:text-slate-200"
              >
                {wallet.label ?? shortenAddress(wallet.address)}
              </h2>
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
                      {binding.displayName} · {binding.type} · {binding.role} ·{' '}
                      {binding.status}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">No principal bindings</p>
              )}
            </div>

            {devices.length === 0 ? (
              <EmptyState
                title="No devices"
                description="This wallet has no connected devices."
              />
            ) : (
              devices.map(({ device, latest, verification }) => {
                const agentBadge = agentVerificationBadge(verification?.status);
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
          </section>
        ))
      )}
    </div>
  );
}
