import type { Metadata } from 'next';

import { AdminLoginForm } from '@/features/admin/login-form';
import { isAdminConfigured } from '@/server/application/admin/admin-auth';
import { sanitizeAdminNextPath } from '@/server/infrastructure/auth/admin-session';

export const metadata: Metadata = {
  title: 'Admin sign in',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const nextPath = sanitizeAdminNextPath((await searchParams).next);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
      <div className="flex w-full max-w-sm flex-col gap-6 rounded-md border border-slate-800 bg-slate-900 p-6">
        <div>
          <h1 className="text-lg font-semibold text-white">M&amp;V Admin</h1>
          <p className="mt-1 text-sm text-slate-400">
            Measurement &amp; verification console.
          </p>
        </div>
        {isAdminConfigured() ? (
          <AdminLoginForm nextPath={nextPath} />
        ) : (
          <p role="alert" className="text-sm text-amber-200">
            Admin is not configured on this environment. Set ADMIN_PASSWORD to
            enable the console.
          </p>
        )}
      </div>
    </div>
  );
}
