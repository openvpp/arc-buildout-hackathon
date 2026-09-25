import Link from 'next/link';
import type { ReactNode } from 'react';

import { CircleAuthButton, CircleGoogleProvider } from '@/features/auth-circle';

export default function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CircleGoogleProvider>
      <div className="min-h-screen bg-slate-50">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-slate-900">
              Arc EV Fleet
            </span>
            <nav className="flex items-center gap-4 text-sm text-slate-600">
              <Link href="/devices" className="hover:text-slate-900">
                Devices
              </Link>
              <Link href="/globe" className="hover:text-slate-900">
                Globe
              </Link>
            </nav>
          </div>
          <CircleAuthButton />
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </CircleGoogleProvider>
  );
}
