'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils/cn';

import { ADMIN_NAV } from './admin-nav';

function isAdminNavActive(pathname: string, href: string): boolean {
  // Home must be exact — otherwise every /admin/* route highlights it.
  if (href === '/admin') {
    return pathname === '/admin';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Super Admin sidebar. Client Component only for active-route highlighting.
 */
export function AdminSidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin" className="w-full">
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {ADMIN_NAV.map((item) => {
          const active = isAdminNavActive(pathname, item.href);
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
