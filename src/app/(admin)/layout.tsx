import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import { AdminLogoutButton } from '@/features/admin';
import { getAdminBasicCredentials } from '@/server/config/env';
import {
  adminAuthFailureResponse,
  evaluateAdminBasicAuth,
} from '@/server/infrastructure/auth/admin-basic-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Super-admin shell. Defense-in-depth Basic Auth (middleware also gates /admin).
 */
export default async function AdminGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const decision = evaluateAdminBasicAuth(
    requestHeaders.get('authorization'),
    getAdminBasicCredentials(),
  );
  if (!decision.ok) {
    return adminAuthFailureResponse(decision) as unknown as ReactNode;
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
