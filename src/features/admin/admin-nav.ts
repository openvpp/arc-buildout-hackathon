export type AdminNavItem = {
  readonly title: string;
  readonly href: string;
  readonly description: string;
};

/** Admin sidebar. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
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
    title: 'Verification',
    href: '/admin/verification',
    description: 'Every record and its latest verdict.',
  },
] as const;
