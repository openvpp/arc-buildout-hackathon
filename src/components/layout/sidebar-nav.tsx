'use client';

import Link from 'next/link';

import { siteConfig } from '@/config/site';
import { useActivePath } from '@/hooks/use-active-path';
import { cn } from '@/lib/utils/cn';

/**
 * Primary navigation. Client Component only because it highlights the active
 * route from the live pathname. Uses `next/link`, semantic list markup, and
 * `aria-current` for accessible, keyboard-navigable links.
 */
export function SidebarNav() {
  const isActive = useActivePath();

  return (
    <nav aria-label="Primary" className="w-full">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {siteConfig.nav.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href} className="shrink-0 md:shrink">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none',
                  active
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
