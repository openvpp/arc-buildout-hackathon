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

/**
 * Arc's public shared RPC, used when ARC_RPC_URL is unset. It is
 * rate-limited; heavy readers should set a provider URL. Null for unknown
 * chains, which must configure ARC_RPC_URL.
 */
export function defaultArcRpcUrl(chainId: string): string | null {
  switch (arcNetworkFor(chainId)) {
    case 'mainnet':
      return 'https://rpc.mainnet.arc.io';
    case 'testnet':
      return 'https://rpc.testnet.arc.io';
    case 'unknown':
      return null;
  }
}

export function defaultArcExplorerUrl(chainId: string): string {
  return arcNetworkFor(chainId) === 'mainnet'
    ? 'https://explorer.arc.io'
    : 'https://explorer.testnet.arc.io';
}

/** Blockscout's Etherscan-compatible API, used only to discover events. */
export function defaultArcExplorerApiUrl(chainId: string): string {
  return `${defaultArcExplorerUrl(chainId)}/api`;
}
