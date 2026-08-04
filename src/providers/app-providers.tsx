import type { ReactNode } from 'react';

import { ClientAppProviders } from '@/providers/client-app-providers';

/**
 * Composition root for all client-side providers. Kept as the single place to
 * add future providers (theme, feature flags) so the root layout stays thin.
 * Server Component that renders client providers as children.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <ClientAppProviders>{children}</ClientAppProviders>;
}
