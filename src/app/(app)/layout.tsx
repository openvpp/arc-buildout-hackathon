import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { arcNetworkDisplayName } from '@/config/arc-network';
import { env } from '@/config/env';
import { CircleAuthButton } from '@/features/auth-circle';
import { DeviceOnboardModalProvider } from '@/features/onboarding';
import { APP_NAV } from '@/features/unlocks/app-nav';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createServerLogger({ component: 'app-layout' });

/**
 * The signed-in app: the shared shell (same layout as /admin). Signed out,
 * only the header shows; pages render their own sign-in prompt.
 */
export default async function AppGroupLayout({
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
    log.error('app.session_lookup_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
  return (
    <DeviceOnboardModalProvider>
      <AppShell
        variant="app"
        brand="Arc EV Fleet"
        homeHref="/dashboard"
        navLabel="App"
        nav={walletId !== null ? APP_NAV : []}
        badges={
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/70 uppercase">
            {arcNetworkDisplayName(env.NEXT_PUBLIC_ARC_CHAIN_ID)}
          </span>
        }
        actions={
          <CircleAuthButton
            key={walletId ?? 'signed-out'}
            initialWalletAddress={walletAddress}
          />
        }
      >
        {children}
      </AppShell>
    </DeviceOnboardModalProvider>
  );
}
