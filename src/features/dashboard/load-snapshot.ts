import 'server-only';

import { cookies } from 'next/headers';

import { listDashboardSnapshot } from '@/server/application/dashboard/list-dashboard';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import {
  DASHBOARD_SESSION_COOKIE,
  verifyDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'dashboard-loader' });

/**
 * Server Component data loader for the dashboard.
 * Scoped to the Web3Auth owner session cookie (principal’s wallets only).
 */
export async function loadDashboardSnapshot() {
  try {
    const env = getServerEnv();
    const token = (await cookies()).get(DASHBOARD_SESSION_COOKIE)?.value;
    const session = await verifyDashboardSessionToken({
      token,
      secret: env.API_KEY_HASH_SECRET,
    });
    if (!session.ok) {
      return { ok: false as const, reason: 'unauthenticated' as const };
    }

    const container = getContainer();
    const snapshot = await listDashboardSnapshot(
      container.db,
      session.claims.principalId,
    );
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
