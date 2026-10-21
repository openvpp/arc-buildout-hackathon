import type { Metadata } from 'next';

import { AdminMetricCard } from '@/features/admin/metric-card';
import { getAdminOverview } from '@/server/application/admin/get-admin-overview';
import { getDb } from '@/server/infrastructure/db/client';

export const metadata: Metadata = { title: 'Admin overview' };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminOverviewPage() {
  const overview = await getAdminOverview(getDb());
  const { verification: v } = overview;
  const checked = v.verified + v.verifiedWithWarnings + v.unverified;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Overview</h1>
        <p className="mt-1 text-sm text-slate-400">
          Fleet and the measurement &amp; verification layer at a glance.
        </p>
      </div>

      <section aria-labelledby="fleet" className="flex flex-col gap-3">
        <h2 id="fleet" className="text-sm font-medium text-slate-300">
          Fleet
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <AdminMetricCard
            label="Devices"
            value={overview.devices.total}
            href="/admin/devices"
          />
          <AdminMetricCard label="Minted" value={overview.devices.minted} />
          <AdminMetricCard label="Active" value={overview.devices.active} />
        </div>
      </section>

      <section aria-labelledby="records" className="flex flex-col gap-3">
        <h2 id="records" className="text-sm font-medium text-slate-300">
          On-chain records
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <AdminMetricCard label="Records" value={overview.records.total} />
          <AdminMetricCard
            label="Anchored"
            value={overview.records.anchored}
            tone="success"
          />
          <AdminMetricCard
            label="Awaiting anchor"
            value={overview.records.awaitingAnchor}
            tone="warning"
          />
          <AdminMetricCard
            label="Failed"
            value={overview.records.failed}
            tone={overview.records.failed > 0 ? 'danger' : 'neutral'}
          />
        </div>
      </section>

      <section aria-labelledby="verification" className="flex flex-col gap-3">
        <h2 id="verification" className="text-sm font-medium text-slate-300">
          Independent verification
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <AdminMetricCard
            label="Verified"
            value={v.verified}
            tone="success"
            href="/admin/verification?verdict=verified"
          />
          <AdminMetricCard
            label="With warnings"
            value={v.verifiedWithWarnings}
            tone="warning"
            href="/admin/verification?verdict=verified_with_warnings"
          />
          <AdminMetricCard
            label="Unverified"
            value={v.unverified}
            tone={v.unverified > 0 ? 'danger' : 'neutral'}
            href="/admin/verification?verdict=unverified"
          />
          <AdminMetricCard
            label="Pending"
            value={v.pending}
            href="/admin/verification?verdict=pending"
          />
          <AdminMetricCard
            label="Not yet checked"
            value={v.unchecked}
            href="/admin/verification?verdict=unchecked"
          />
        </div>
        <p className="text-xs text-slate-500">
          {checked === 0
            ? 'No anchored record has been independently checked yet.'
            : `${Math.round(((v.verified + v.verifiedWithWarnings) / checked) * 100)}% of checked records verified.`}
          {v.lastCheckedAt !== null
            ? ` Last check ${v.lastCheckedAt.toUTCString()}.`
            : ''}
        </p>
      </section>
    </div>
  );
}
