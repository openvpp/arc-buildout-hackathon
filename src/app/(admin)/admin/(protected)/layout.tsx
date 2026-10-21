import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin/admin-shell';
import { requireAdminSession } from '@/features/admin/server';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Middleware gates /admin too; this re-checks the account in the database. */
export default async function AdminProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminSession();
  if (!session.ok) {
    redirect('/admin/login');
  }
  return <AdminShell username={session.admin.username}>{children}</AdminShell>;
}
