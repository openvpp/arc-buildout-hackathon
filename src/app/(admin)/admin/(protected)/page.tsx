import type { Metadata } from 'next';
import Link from 'next/link';

import { PageHeader } from '@/components/common/page-header';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import {
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
      <PageHeader
        title="Home"
        description="Cross-tenant overview. Open Fleet flexibility, Payments, or Devices from the sidebar for detail."
      />

      <section
        aria-labelledby="admin-overview-heading"
        className="flex flex-col gap-3"
      >
        <h2 id="admin-overview-heading" className="sr-only">
          Overview
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <Link
                href="/admin/devices"
                className="mt-2 block text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
              >
                View devices
              </Link>
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
            <CardTitle>Payments</CardTitle>
            <CardDescription>
              <span className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                {paymentCount}
              </span>{' '}
              recent
              <Link
                href="/admin/payments"
                className="mt-2 block text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
              >
                View payments
              </Link>
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
              <Link
                href="/admin/fleet-flexibility"
                className="mt-2 block text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
              >
                View fleet flexibility
              </Link>
            </CardDescription>
          </Card>
        </div>
      </section>
    </div>
  );
}
