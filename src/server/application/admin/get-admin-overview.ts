import { count, max, sql } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import {
  deviceEvents,
  devices,
  eventVerifications,
} from '@/server/infrastructure/db/schema';

export type AdminOverview = {
  devices: { total: number; minted: number; active: number };
  records: {
    total: number;
    anchored: number;
    awaitingAnchor: number;
    failed: number;
  };
  verification: {
    verified: number;
    verifiedWithWarnings: number;
    unverified: number;
    pending: number;
    unchecked: number;
    lastCheckedAt: Date | null;
  };
};

/** Fleet-wide counts for the admin overview (aggregates only). */
export async function getAdminOverview(db: Database): Promise<AdminOverview> {
  const [deviceCounts] = await db
    .select({
      total: count(),
      minted:
        sql<number>`count(*) filter (where ${devices.mintStatus} = 'minted')`.mapWith(
          Number,
        ),
      active:
        sql<number>`count(*) filter (where ${devices.status} = 'active')`.mapWith(
          Number,
        ),
    })
    .from(devices);

  const statusRows = await db
    .select({ status: deviceEvents.status, n: count() })
    .from(deviceEvents)
    .groupBy(deviceEvents.status);
  const verdictRows = await db
    .select({ verdict: deviceEvents.verificationStatus, n: count() })
    .from(deviceEvents)
    .where(sql`${deviceEvents.status} = 'confirmed'`)
    .groupBy(deviceEvents.verificationStatus);
  const [last] = await db
    .select({ at: max(eventVerifications.checkedAt) })
    .from(eventVerifications);

  const byStatus = (value: string) =>
    statusRows.find((row) => row.status === value)?.n ?? 0;
  const byVerdict = (value: string) =>
    verdictRows.find((row) => row.verdict === value)?.n ?? 0;

  return {
    devices: {
      total: deviceCounts?.total ?? 0,
      minted: deviceCounts?.minted ?? 0,
      active: deviceCounts?.active ?? 0,
    },
    records: {
      total: statusRows.reduce((sum, row) => sum + row.n, 0),
      anchored: byStatus('confirmed'),
      awaitingAnchor: byStatus('queued') + byStatus('pending'),
      failed: byStatus('failed'),
    },
    verification: {
      verified: byVerdict('verified'),
      verifiedWithWarnings: byVerdict('verified_with_warnings'),
      unverified: byVerdict('unverified'),
      pending: byVerdict('pending'),
      unchecked: byVerdict('unchecked'),
      lastCheckedAt: last?.at ?? null,
    },
  };
}
