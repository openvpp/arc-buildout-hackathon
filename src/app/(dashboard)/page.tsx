import type { Metadata } from 'next';

import { GlobeView } from '@/features/globe/globe-view';
import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';

export const metadata: Metadata = {
  title: 'Arc EV Fleet',
  description: 'Your fleet, mapped.',
};

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The globe is the permanent base view — it renders whether or not anyone
 * is signed in. Sign-in and adding a device only add pins on top of it;
 * neither ever gates the page itself.
 *
 * `key` is tied to the signed-in wallet (or 'anon') so that a sign-in/out
 * — which calls router.refresh() — forces GlobeView to remount and refetch
 * pins for the new identity, instead of silently keeping stale data.
 */
export default async function HomePage() {
  const principal = await getCurrentPrincipal();
  return <GlobeView key={principal?.walletId ?? 'anon'} />;
}
