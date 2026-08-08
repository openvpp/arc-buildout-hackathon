/**
 * Client-facing Web3Auth id-token helpers.
 * Prefer importing from `@/lib/auth/web3auth-wallet-claims` for new code.
 */
export {
  ownedEvmAddressesFromIdToken,
  resolveWalletAddressForOnboarding,
} from '@/lib/auth/web3auth-wallet-claims';
