import Link from 'next/link';
import type { ReactNode } from 'react';

import type { NavItem } from './nav';
import { SidebarNav } from './sidebar-nav';
import { SHELL_VARIANTS, type ShellVariant } from './shell-variants';

/**
 * Shared chrome for the signed-in app and the admin console: a header
 * (brand, badges, actions), a sidebar, and the main column. Pass no nav
 * items to render the header and main column only (e.g. signed out).
 */
export function AppShell({
  variant,
  brand,
  homeHref,
  badges,
  actions,
  nav,
  navLabel,
  children,
}: {
  readonly variant: ShellVariant;
  readonly brand: string;
  readonly homeHref: string;
  readonly badges?: ReactNode;
  readonly actions?: ReactNode;
  readonly nav: readonly NavItem[];
  readonly navLabel: string;
  readonly children: ReactNode;
}) {
  const theme = SHELL_VARIANTS[variant];
  return (
    <div className={theme.page}>
      <a
        href="#main-content"
        className={`sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 ${theme.skip}`}
      >
        Skip to main content
      </a>
      <header className={theme.header}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={homeHref} className={theme.brand}>
              {brand}
            </Link>
            {badges}
          </div>
          {actions !== undefined ? (
            <div className="flex items-center gap-3 text-xs">{actions}</div>
          ) : null}
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
        {nav.length > 0 ? (
          <aside className="md:w-48 md:shrink-0">
            <SidebarNav
              items={nav}
              label={navLabel}
              exactHref={homeHref}
              variant={variant}
            />
          </aside>
        ) : null}
        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
