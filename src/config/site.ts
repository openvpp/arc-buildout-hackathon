import { env } from '@/config/env';

/**
 * Static site metadata and primary navigation.
 *
 * Pure configuration with no runtime behavior. `satisfies` gives us a precise
 * literal type while still validating the shape against `SiteConfig`.
 */

export type NavItem = {
  readonly title: string;
  readonly href: Route;
  readonly description: string;
};

/** App-internal routes known at build time. */
export type Route = '/' | '/dashboard' | '/devices' | '/settings';

export type SiteConfig = {
  readonly name: string;
  readonly description: string;
  readonly nav: readonly NavItem[];
};

export const siteConfig = {
  name: env.NEXT_PUBLIC_APP_NAME,
  description:
    'Dashboard for verified EV telemetry nanopayments. Displays telemetry ' +
    'records and independent on-chain verification evidence. Not the source ' +
    'of truth for payments or verification.',
  nav: [
    {
      title: 'Dashboard',
      href: '/dashboard',
      description: 'Overview of telemetry and verification status.',
    },
    {
      title: 'Devices',
      href: '/devices',
      description: 'EV devices for your connected wallet.',
    },
    {
      title: 'Settings',
      href: '/settings',
      description: 'Appearance and local dashboard preferences.',
    },
  ],
} satisfies SiteConfig;
