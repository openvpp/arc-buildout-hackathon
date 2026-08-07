import Link from 'next/link';
import type { ReactNode } from 'react';

import { SidebarNav } from '@/components/layout/sidebar-nav';
import { siteConfig } from '@/config/site';

/**
 * Accessible application shell: a skip link, banner header, primary navigation
 * landmark, and the main content region. Server Component — only the nav's
 * active-state highlighting is client-side.
 */
export function DashboardShell({
  children,
  headerActions,
}: {
  children: ReactNode;
  headerActions?: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to main content
      </a>

      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              {siteConfig.name}
            </span>
          </Link>
          {headerActions !== undefined ? (
            <div className="shrink-0">{headerActions}</div>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-52 md:shrink-0">
          <SidebarNav />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
