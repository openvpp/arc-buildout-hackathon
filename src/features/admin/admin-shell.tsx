import Link from 'next/link';
import type { ReactNode } from 'react';

import { arcNetworkDisplayName } from '@/config/arc-network';
import { env } from '@/config/env';

import { AdminSidebarNav } from './admin-sidebar-nav';

/** Authenticated admin chrome: header, sidebar, main. */
export function AdminShell({
  username,
  children,
}: {
  readonly username: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="text-sm font-semibold tracking-tight"
            >
              M&amp;V Admin
            </Link>
            <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200 uppercase">
              Internal
            </span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-300 uppercase">
              {arcNetworkDisplayName(env.NEXT_PUBLIC_ARC_CHAIN_ID)}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span>{username}</span>
            <a
              href="/admin/logout"
              className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
            >
              Log out
            </a>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="md:w-48 md:shrink-0">
          <AdminSidebarNav />
        </aside>
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
