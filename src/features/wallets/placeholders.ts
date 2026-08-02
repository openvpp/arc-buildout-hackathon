import { toWalletId } from '@/types/branded';
import type { Wallet } from '@/types/domain';

/**
 * PLACEHOLDER wallets for shell/layout development only.
 *
 * These are obviously-fake EXAMPLE structures, NOT data from a live backend.
 * Always render them behind a visible placeholder notice. They contain no
 * secrets — public example addresses only, never private keys or seed phrases.
 */
export const PLACEHOLDER_WALLETS: readonly Wallet[] = [
  {
    id: toWalletId('wallet_example_alpha'),
    label: 'Example Wallet Alpha',
    address: '0xEXAMPLE0000000000000000000000000000ALPHA',
    deviceCount: 2,
  },
  {
    id: toWalletId('wallet_example_beta'),
    label: 'Example Wallet Beta',
    address: '0xEXAMPLE00000000000000000000000000000BETA',
    deviceCount: 1,
  },
] as const;
