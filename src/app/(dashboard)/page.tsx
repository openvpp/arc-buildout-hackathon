import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { GlobeView } from '@/features/globe/globe-view';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';

export const metadata: Metadata = {
  title: 'Arc EV Fleet',
  description: 'Your fleet, mapped.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function HomePage() {
  const principal = await getCurrentPrincipal();

  if (principal === null) {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-6">
        <EmptyState
          title="Sign in to continue"
          description="Sign in with Google (top right) to create or access your Circle wallet and see your fleet."
        />
      </div>
    );
  }

  return <GlobeView />;
}
