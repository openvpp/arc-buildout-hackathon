import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';

import { GlobeView } from './globe-view';

export const metadata: Metadata = {
  title: 'Globe',
  description: 'Your fleet on the map.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function GlobePage() {
  const principal = await getCurrentPrincipal();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Globe" description="Your devices, mapped." />
      {principal === null ? (
        <EmptyState
          title="Sign in to continue"
          description="Sign in with Google to see your fleet on the map."
        />
      ) : (
        <GlobeView />
      )}
    </div>
  );
}
