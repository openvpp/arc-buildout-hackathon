/**
 * Arc network facts derived from the chain id. Pure and browser-safe (no
 * env access), so server code and client UI agree on network naming.
 */

export const ARC_MAINNET_CHAIN_ID = '5042';
export const ARC_TESTNET_CHAIN_ID = '5042002';

export type ArcNetwork = 'mainnet' | 'testnet' | 'unknown';

export function arcNetworkFor(chainId: string): ArcNetwork {
  if (chainId === ARC_MAINNET_CHAIN_ID) return 'mainnet';
  if (chainId === ARC_TESTNET_CHAIN_ID) return 'testnet';
  return 'unknown';
}

/** Human name, e.g. for consent copy: "Arc mainnet" / "Arc testnet". */
export function arcNetworkDisplayName(chainId: string): string {
  const network = arcNetworkFor(chainId);
  return network === 'unknown' ? `Arc (chain ${chainId})` : `Arc ${network}`;
}

/** Stored on `devices.network`, e.g. `arc-mainnet-5042`. */
export function arcNetworkLabel(chainId: string): string {
  const network = arcNetworkFor(chainId);
  return network === 'unknown'
    ? `arc-chain-${chainId}`
    : `arc-${network}-${chainId}`;
}

/** Public RPC used only when ARC_RPC_URL is unset — testnet only. */
export function defaultArcRpcUrl(chainId: string): string | null {
  return arcNetworkFor(chainId) === 'testnet'
    ? 'https://rpc.testnet.arc.network'
    : null;
}

export function defaultArcExplorerUrl(chainId: string): string {
  return arcNetworkFor(chainId) === 'mainnet'
    ? 'https://explorer.arc.io'
    : 'https://testnet.arcscan.app';
}
