import type { ReactNode } from 'react';

import { QueryProvider } from '@/providers/query-provider';

/**
 * Composition root for all client-side providers. Kept as the single place to
 * add future providers (theme, feature flags, auth) so the root layout stays
 * thin. Server Component that renders client providers as children.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <QueryProvider>{children}</QueryProvider>;
}
