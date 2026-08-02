import 'server-only';

import { eq } from 'drizzle-orm';

import { listDashboardSnapshot } from '@/server/application/dashboard/list-dashboard';
import { getContainer } from '@/server/bootstrap/container';
import { apiCredentials, principals } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'dashboard-loader' });

/**
 * Server Component data loader for the dashboard.
 * Uses application use cases — never queries from React components directly.
 */
export async function loadDashboardSnapshot() {
  try {
    const container = getContainer();
    const [agent] = await container.db
      .select({ id: principals.id })
      .from(principals)
      .innerJoin(apiCredentials, eq(apiCredentials.principalId, principals.id))
      .where(eq(principals.type, 'autonomous_agent'))
      .limit(1);

    if (agent === undefined) {
      return { ok: false as const, reason: 'no_seed_principal' as const };
    }

    const snapshot = await listDashboardSnapshot(container.db, agent.id);
    return { ok: true as const, snapshot };
  } catch (error: unknown) {
    log.warn('dashboard.load_failed', {
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
