'use client';

import { usePathname } from 'next/navigation';

/**
 * Returns a predicate for whether a given nav href is "active" for the current
 * route, matching the exact path or any nested sub-route. Client-only because
 * it reads the live pathname.
 */
export function useActivePath(): (href: string) => boolean {
  const pathname = usePathname();
  return (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);
}
