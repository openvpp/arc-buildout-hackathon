'use client';

import Link from 'next/link';

import { cn } from '@/lib/utils/cn';

export type NavListItem = {
  readonly href: string;
  readonly title: string;
};

/**
 * Shared sidebar/nav list chrome. Callers supply active-route resolution.
 */
export function NavList({
  items,
  ariaLabel,
  isActive,
}: {
  readonly items: readonly NavListItem[];
  readonly ariaLabel: string;
  readonly isActive: (href: string) => boolean;
}) {
  return (
    <nav aria-label={ariaLabel} className="w-full">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {items.map((item) => {
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
