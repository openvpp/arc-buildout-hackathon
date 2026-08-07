import type { Metadata } from 'next';

import { PageHeader } from '@/components/common/page-header';
import { AdminLoginForm } from '@/features/admin';
import { getAdminBasicCredentials } from '@/server/config/env';
import { sanitizeAdminNextPath } from '@/server/infrastructure/auth/admin-session';

export const metadata: Metadata = {
  title: 'Admin sign in',
  description: 'Sign in to the super-admin console.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeAdminNextPath(params.next);
  const configured = getAdminBasicCredentials() !== null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-md border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <PageHeader
          title="Super Admin"
          description="Sign in with the configured admin username and password."
        />
        {!configured ? (
          <p
            role="alert"
            className="text-sm text-amber-800 dark:text-amber-200"
          >
            Admin is not configured on this environment. Set ADMIN_USERNAME and
            ADMIN_PASSWORD to enable the console.
          </p>
        ) : (
          <AdminLoginForm nextPath={nextPath} />
        )}
      </div>
    </div>
  );
}
