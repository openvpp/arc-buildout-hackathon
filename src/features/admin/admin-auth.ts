import 'server-only';

import { cookies } from 'next/headers';

import { getAdminBasicCredentials, getServerEnv } from '@/server/config/env';
import {
  ADMIN_SESSION_COOKIE,
  sanitizeAdminNextPath,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';

export { ADMIN_PAYMENTS_LIMIT } from '@/server/application/admin/list-admin-payments';
export { sanitizeAdminNextPath };

export function isAdminConfigured(): boolean {
  return getAdminBasicCredentials() !== null;
}

export async function requireAdminSession(): Promise<
  { ok: true } | { ok: false; reason: 'not_configured' | 'unauthenticated' }
> {
  if (getAdminBasicCredentials() === null) {
    return { ok: false, reason: 'not_configured' };
  }

  const env = getServerEnv();
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifyAdminSessionToken({
    token,
    secret: env.API_KEY_HASH_SECRET,
  });
  if (!session.ok) {
    return { ok: false, reason: 'unauthenticated' };
  }
  return { ok: true };
}
