import type { Metadata } from 'next';

import { GlobeView } from '@/features/globe/globe-view';

export const metadata: Metadata = {
  title: 'Arc EV Fleet',
  description: 'Your fleet, mapped.',
};

/**
 * The globe is the permanent base view: a public map of every connected
 * device, independent of who (if anyone) is signed in. Sign-in and adding
 * a device happen on top of it; neither ever gates the page itself.
 */
export default function HomePage() {
  return <GlobeView />;
}
