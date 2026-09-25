import type { ReactNode } from 'react';

/** Standard content wrapper for pages that sit under the fixed header (everything except the full-bleed globe). */
export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-7xl px-6 pt-28 pb-12">{children}</div>;
}
