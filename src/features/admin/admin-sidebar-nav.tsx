'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ADMIN_NAV } from './admin-nav';

function isActive(pathname: string, href: string): boolean {
  // Overview must be exact, or every /admin/* route would highlight it.
  return href === '/admin'
    ? pathname === '/admin'
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Client Component only for active-route highlighting. */
export function AdminSidebarNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin">
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {ADMIN_NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.description}
                className={`block rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                  active
                    ? 'bg-slate-800 font-medium text-white'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
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
