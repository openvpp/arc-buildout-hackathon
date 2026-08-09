'use client';

import { siteConfig } from '@/config/site';
import { useActivePath } from '@/hooks/use-active-path';

import { NavList } from './nav-list';

/**
 * Primary navigation. Client Component only because it highlights the active
 * route from the live pathname.
 */
export function SidebarNav() {
  const isActive = useActivePath();

  return (
    <NavList items={siteConfig.nav} ariaLabel="Primary" isActive={isActive} />
  );
}
