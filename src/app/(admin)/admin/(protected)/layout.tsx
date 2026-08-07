import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminLogoutButton } from '@/features/admin';
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

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              Super Admin
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">
              Internal
            </span>
          </div>
          <AdminLogoutButton />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
    </div>
  );
}
