export type AdminNavItem = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

/** Primary Super Admin navigation (sidebar). */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  {
    title: 'Home',
    href: '/admin',
    description: 'Cross-tenant overview counts.',
  },
  {
    title: 'Fleet flexibility',
    href: '/admin/fleet-flexibility',
    description: 'Charge headroom across verified vehicles.',
  },
  {
    title: 'Payments',
    href: '/admin/payments',
    description: 'Settled Circle Gateway nanopayments.',
  },
  {
    title: 'Devices',
    href: '/admin/devices',
    description: 'All tenants’ devices and latest evidence.',
  },
] as const;
