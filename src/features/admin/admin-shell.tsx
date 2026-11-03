import type { ReactNode } from 'react';

import { AppShell } from '@/components/layout/app-shell';
import { arcNetworkDisplayName } from '@/config/arc-network';
import { env } from '@/config/env';

import { ADMIN_NAV } from './admin-nav';

/** Authenticated admin chrome: the shared shell in its admin look. */
export function AdminShell({
  username,
  children,
}: {
  readonly username: string;
  readonly children: ReactNode;
}) {
  return (
    <AppShell
      variant="admin"
      brand="M&V Admin"
      homeHref="/admin"
      navLabel="Admin"
      nav={ADMIN_NAV}
      badges={
        <>
          <span className="rounded bg-amber-950 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-200 uppercase">
            Internal
          </span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-300 uppercase">
            {arcNetworkDisplayName(env.NEXT_PUBLIC_ARC_CHAIN_ID)}
          </span>
        </>
      }
      actions={
        <>
          <span className="text-slate-400">{username}</span>
          <a
            href="/admin/logout"
            className="rounded-md border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
          >
            Log out
          </a>
        </>
      }
    >
      {children}
    </AppShell>
  );
}
