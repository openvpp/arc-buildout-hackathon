import Link from 'next/link';
import type { ReactNode } from 'react';

import { CircleAuthButton, CircleGoogleProvider } from '@/features/auth-circle';
import { DeviceOnboardModalProvider } from '@/features/onboarding';

export default function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <CircleGoogleProvider>
      <DeviceOnboardModalProvider>
        <div className="min-h-screen bg-background">
          <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between p-6">
            <Link
              href="/"
              className="text-base font-bold tracking-tight text-primary-500"
            >
              Arc EV Fleet
            </Link>
            <CircleAuthButton />
          </header>
          {children}
        </div>
      </DeviceOnboardModalProvider>
    </CircleGoogleProvider>
  );
}
