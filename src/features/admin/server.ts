import { cookies } from 'next/headers';

import {
  getAdminAccount,
  type AdminAccount,
} from '@/server/application/admin/admin-auth';
import { getServerEnv } from '@/server/config/env';
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';
import { getDb } from '@/server/infrastructure/db/client';

/** Session + account check for admin Server Components and actions. */
export async function requireAdminSession(): Promise<
  { ok: true; admin: AdminAccount } | { ok: false }
> {
  const env = getServerEnv();
  if (env.ADMIN_PASSWORD.length === 0) {
    return { ok: false };
  }
  const session = await verifyAdminSessionToken({
    token: (await cookies()).get(ADMIN_SESSION_COOKIE)?.value,
    secret: env.API_KEY_HASH_SECRET,
  });
  if (!session.ok) {
    return { ok: false };
  }
  const admin = await getAdminAccount(getDb(), session.claims);
  return admin === null ? { ok: false } : { ok: true, admin };
}
