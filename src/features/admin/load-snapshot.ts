import 'server-only';

import { listRecentAdminPayments } from '@/server/application/admin/list-admin-payments';
import { listAdminSnapshotForBoundWallets } from '@/server/application/admin/list-admin-snapshot';
import { getContainer } from '@/server/bootstrap/container';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'admin-loader' });

/**
 * Server Component data loader for the super-admin screen.
 * Caller must already have passed the admin session gate.
 */
export async function loadAdminSnapshot() {
  try {
    const container = getContainer();
    const [snapshot, payments] = await Promise.all([
      listAdminSnapshotForBoundWallets(container.db),
      listRecentAdminPayments(container.db),
    ]);
    if (snapshot.length === 0) {
      return { ok: false as const, reason: 'no_bound_wallets' as const };
    }
    return { ok: true as const, snapshot, payments };
  } catch (error: unknown) {
    log.warn('admin.load_failed', {
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
