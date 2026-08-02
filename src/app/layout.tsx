import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { siteConfig } from '@/config/site';
import { AppProviders } from '@/providers/app-providers';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  robots: { index: false, follow: false },
  applicationName: siteConfig.name,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
