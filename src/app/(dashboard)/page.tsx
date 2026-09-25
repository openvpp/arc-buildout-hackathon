import type { Metadata } from 'next';
import Link from 'next/link';

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
      <EmptyState
        title="Sign in to continue"
        description="Sign in with Google (top right) to create or access your Circle wallet and see your fleet."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Your fleet, mapped.</p>
        <Link
          href="/devices/onboard"
          className="inline-flex rounded-md bg-slate-900 px-3.5 py-2 text-sm font-medium text-white"
        >
          Add vehicle
        </Link>
      </div>
      <GlobeView />
    </div>
  );
}
