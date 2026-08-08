import { EmptyState } from '@/components/common/empty-state';
import { PageHeader } from '@/components/common/page-header';

/**
 * Shared empty/unavailable body when admin snapshot cannot load.
 */
export function AdminUnavailableState({
  title,
  reason,
}: {
  readonly title: string;
  readonly reason: 'no_bound_wallets' | 'database_unavailable';
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description="Cross-tenant admin view of wallets, devices, and verification evidence."
      />
      <EmptyState
        title="No data"
        description={
          reason === 'no_bound_wallets'
            ? 'No wallets are bound to any principal yet.'
            : 'Nothing to show right now.'
        }
      />
    </div>
  );
}
