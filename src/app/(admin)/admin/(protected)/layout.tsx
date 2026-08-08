import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin';
import { getAdminBasicCredentials, getServerEnv } from '@/server/config/env';
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Authenticated super-admin shell. Middleware also gates /admin; this is
 * defense-in-depth for the session cookie.
 */
export default async function AdminProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const credentials = getAdminBasicCredentials();
  if (credentials === null) {
    redirect('/admin/login');
  }

  const env = getServerEnv();
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifyAdminSessionToken({
    token,
    secret: env.API_KEY_HASH_SECRET,
  });
  if (!session.ok) {
    redirect('/admin/login');
  }

  return <AdminShell>{children}</AdminShell>;
}
