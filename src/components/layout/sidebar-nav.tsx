'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { NavItem } from './nav';
import { SHELL_VARIANTS, type ShellVariant } from './shell-variants';

function isActive(pathname: string, href: string, exactHref: string): boolean {
  // The overview must match exactly, or every page under it would highlight.
  return href === exactHref
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

/** Client Component only for active-route highlighting. */
export function SidebarNav({
  items,
  label,
  exactHref,
  variant,
}: {
  readonly items: readonly NavItem[];
  readonly label: string;
  /** The overview route, highlighted only on an exact match. */
  readonly exactHref: string;
  readonly variant: ShellVariant;
}) {
  const pathname = usePathname();
  const theme = SHELL_VARIANTS[variant];
  return (
    <nav aria-label={label}>
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {items.map((item) => {
          const active = isActive(pathname, item.href, exactHref);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                title={item.description}
                className={`block rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                  active ? theme.navActive : theme.navIdle
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
