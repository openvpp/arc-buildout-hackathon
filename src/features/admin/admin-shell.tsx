import type { ReactNode } from 'react';

import { AdminSidebarNav } from './admin-sidebar-nav';
import { AdminLogoutButton } from './logout-button';

/**
 * Authenticated Super Admin chrome: header, sidebar, main. Server Component
 * shell; only sidebar active-state is client-side.
 */
export function AdminShell({ children }: { readonly children: ReactNode }) {
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
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tracking-tight">
              Super Admin
            </span>
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800 uppercase dark:bg-amber-950 dark:text-amber-200">
              Internal
            </span>
          </div>
          <AdminLogoutButton />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-52 md:shrink-0">
          <AdminSidebarNav />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
