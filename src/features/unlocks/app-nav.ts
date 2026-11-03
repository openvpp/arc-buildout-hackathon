import type { NavItem } from '@/components/layout/nav';

/** Signed-in app sidebar (same layout as the admin console). */
export const APP_NAV: readonly NavItem[] = [
  {
    title: 'Overview',
    href: '/dashboard',
    description: 'Your devices, records and unlocks at a glance.',
  },
  {
    title: 'Devices',
    href: '/devices',
    description: 'Your vehicles and their on-chain events.',
  },
  {
    title: 'Payments',
    href: '/payments',
    description: 'Events you unlocked and what each cost.',
  },
  {
    title: 'Verify',
    href: '/verify',
    description: 'Check any record against Arc yourself.',
  },
  {
    title: 'Globe',
    href: '/',
    description: 'Every connected device, on the public map.',
  },
] as const;
