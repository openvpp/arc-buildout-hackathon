import Link from 'next/link';
import type { ReactNode } from 'react';

import { CircleAuthButton, CircleGoogleProvider } from '@/features/auth-circle';
import { DeviceOnboardModalProvider } from '@/features/onboarding';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createServerLogger({ component: 'dashboard-layout' });

export default async function DashboardGroupLayout({
  children,
}: {
  children: ReactNode;
}) {
  let walletAddress: string | null = null;
  let walletId: string | null = null;
  try {
    const principal = await getCurrentPrincipal();
    walletAddress = principal?.walletAddress ?? null;
    walletId = principal?.walletId ?? null;
  } catch (error) {
    // The globe is public. A database outage must not take the map down
    // with the header; privileged pages still query the session themselves.
    log.error('dashboard.session_lookup_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

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
            <CircleAuthButton
              key={walletId ?? 'signed-out'}
              initialWalletAddress={walletAddress}
            />
          </header>
          {children}
        </div>
      </DeviceOnboardModalProvider>
    </CircleGoogleProvider>
  );
}
