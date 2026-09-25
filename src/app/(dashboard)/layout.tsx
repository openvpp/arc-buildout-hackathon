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
      <div className="min-h-screen bg-background">
        <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between p-6">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-primary-500"
            >
              Arc EV Fleet
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <Link
                href="/devices"
                className="rounded-md px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white"
              >
                Devices
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/devices/onboard"
              className="hidden h-[50px] items-center rounded-md border border-primary-500 px-4 text-sm font-medium text-primary-500 hover:bg-primary-500/10 sm:flex"
            >
              Add vehicle
            </Link>
            <CircleAuthButton />
          </div>
        </header>
        {children}
      </div>
    </CircleGoogleProvider>
  );
}
