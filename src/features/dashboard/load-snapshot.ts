import 'server-only';

import { listDashboardSnapshotForBoundWallets } from '@/server/application/dashboard/list-dashboard';
import { getContainer } from '@/server/bootstrap/container';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'dashboard-loader' });

/**
 * Server Component data loader for the dashboard.
 * Shows wallets bound via principal_wallets (seed agent + Web3Auth owners).
 */
export async function loadDashboardSnapshot() {
  try {
    const container = getContainer();
    const snapshot = await listDashboardSnapshotForBoundWallets(container.db);
    if (snapshot.length === 0) {
      return { ok: false as const, reason: 'no_bound_wallets' as const };
    }
    return { ok: true as const, snapshot };
  } catch (error: unknown) {
    log.warn('dashboard.load_failed', {
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
