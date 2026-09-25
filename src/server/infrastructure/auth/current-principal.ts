import { cookies } from 'next/headers';

import { getServerEnv } from '@/server/config/env';
import {
  DASHBOARD_SESSION_COOKIE,
  type DashboardSessionClaims,
  verifyDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';

/** Reads and verifies the dashboard session cookie in a Server Component. */
export async function getCurrentPrincipal(): Promise<DashboardSessionClaims | null> {
  const store = await cookies();
  const token = store.get(DASHBOARD_SESSION_COOKIE)?.value;
  const env = getServerEnv();
  const result = await verifyDashboardSessionToken({
    token,
    secret: env.API_KEY_HASH_SECRET,
  });
  return result.ok ? result.claims : null;
}
