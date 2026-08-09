'use client';

import { usePathname } from 'next/navigation';

import { NavList } from '@/components/layout/nav-list';

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
    <NavList
      items={ADMIN_NAV}
      ariaLabel="Admin"
      isActive={(href) => isAdminNavActive(pathname, href)}
    />
  );
}
