import type { Metadata } from 'next';

import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';

export const metadata: Metadata = {
  title: 'Devices',
  description: 'Your connected EVs.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function DevicesPage() {
  const principal = await getCurrentPrincipal();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Devices"
        description="Your connected EVs, minted on Arc."
      />
      {principal === null ? (
        <EmptyState
          title="Sign in to continue"
          description="Sign in with Google to create or access your Circle wallet."
        />
      ) : (
        <EmptyState
          title="No devices yet"
          description="Device connection is coming in the next phase."
        />
      )}
    </div>
  );
}
