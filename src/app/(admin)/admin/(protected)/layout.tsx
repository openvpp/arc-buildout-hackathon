import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminShell } from '@/features/admin';
import { requireAdminSession } from '@/features/admin/server';

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
  const session = await requireAdminSession();
  if (!session.ok) {
    redirect('/admin/login');
  }

  return <AdminShell>{children}</AdminShell>;
}
