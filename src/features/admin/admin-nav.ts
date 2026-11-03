import type { NavItem } from '@/components/layout/nav';

/** Admin sidebar. */
export const ADMIN_NAV: readonly NavItem[] = [
  {
    title: 'Overview',
    href: '/admin',
    description: 'Fleet and verification at a glance.',
  },
  {
    title: 'Devices',
    href: '/admin/devices',
    description: 'Every device and its on-chain telemetry.',
  },
  {
    title: 'Payments',
    href: '/admin/payments',
    description: 'Every nanopayment and the Gateway balances.',
  },
  {
    title: 'Verification',
    href: '/admin/verification',
    description: 'Every record and its latest verdict.',
  },
] as const;
