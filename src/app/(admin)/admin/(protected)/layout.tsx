import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin/admin-shell';
import { requireAdminSession } from '@/features/admin/server';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Middleware gates /admin by signature only; this re-checks the account and
 * that the session was issued under the current password. A session that
 * fails here is cleared via /admin/logout (redirecting to the login page
 * with the cookie still set would loop).
 */
export default async function AdminProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminSession();
  if (!session.ok) {
    redirect('/admin/logout');
  }
  return <AdminShell username={session.admin.username}>{children}</AdminShell>;
}
