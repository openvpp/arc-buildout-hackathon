import { redirect } from 'next/navigation';

/**
 * Legacy route: one Web3Auth user has a single wallet; multi-wallet browsing
 * lives under Super Admin. Keep a redirect so old bookmarks do not 404.
 */
export default function WalletsPage() {
  redirect('/devices');
}
