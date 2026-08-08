import 'server-only';

import { cookies } from 'next/headers';

import { getBoundDeviceDetail } from '@/server/application/dashboard/list-dashboard';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import {
  DASHBOARD_SESSION_COOKIE,
  verifyDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'device-detail-loader' });

/**
 * Server Component loader for a single vehicle owned by the session principal.
 */
export async function loadDeviceDetail(deviceId: string) {
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
    const detail = await getBoundDeviceDetail(
      container.db,
      deviceId,
      session.claims.principalId,
    );
    if (detail === null) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    return { ok: true as const, detail };
  } catch (error: unknown) {
    log.warn('device_detail.load_failed', {
      deviceId,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
