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
          <span className="text-sm font-semibold text-slate-900">
            Arc EV Fleet
          </span>
          <CircleAuthButton />
        </header>
        <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
      </div>
    </CircleGoogleProvider>
  );
}
