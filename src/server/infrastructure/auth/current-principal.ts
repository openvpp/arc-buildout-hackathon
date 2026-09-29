import { cookies } from 'next/headers';

import { getServerEnv } from '@/server/config/env';
import {
  DASHBOARD_SESSION_COOKIE,
  type DashboardSessionClaims,
  verifyDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';
import { isDashboardSessionActive } from '@/server/infrastructure/auth/session-authorization';
import { getDb } from '@/server/infrastructure/db/client';

/**
 * Reads the dashboard session cookie and confirms the principal still owns
 * an active wallet. A valid signature for a disabled account returns null.
 */
export async function getCurrentPrincipal(): Promise<DashboardSessionClaims | null> {
  const store = await cookies();
  const token = store.get(DASHBOARD_SESSION_COOKIE)?.value;
  const env = getServerEnv();
  const result = await verifyDashboardSessionToken({
    token,
    secret: env.API_KEY_HASH_SECRET,
  });
  if (!result.ok) {
    return null;
  }
  const active = await isDashboardSessionActive(getDb(), result.claims);
  return active ? result.claims : null;
}
