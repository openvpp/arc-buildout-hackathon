import { ExternalLink } from '@/components/common/external-link';

import { arcTxExplorerUrl, isOnchainTxHash, truncateHash } from './format';

const linkClassName =
  'text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200';

/**
 * Shows a DeviceNFT mint explorer link when `nftTransactionHash` is an on-chain
 * tx. Non-on-chain refs are shown as plain text (never linked to Arcscan).
 */
export function DeviceMintTransactionLink({
  nftTransactionHash,
  nftTokenId,
}: {
  readonly nftTransactionHash: string | null | undefined;
  readonly nftTokenId?: string | null;
}) {
  if (
    typeof nftTransactionHash !== 'string' ||
    nftTransactionHash.length === 0
  ) {
    return null;
  }

  if (isOnchainTxHash(nftTransactionHash)) {
    return (
      <ExternalLink
        href={arcTxExplorerUrl(nftTransactionHash)}
        className={linkClassName}
      >
        View mint transaction
        {nftTokenId !== null &&
        nftTokenId !== undefined &&
        nftTokenId.length > 0
          ? ` (#${nftTokenId})`
          : ''}
      </ExternalLink>
    );
  }

  return (
    <span className="text-xs text-slate-600 dark:text-slate-400">
      Mint ref {truncateHash(nftTransactionHash)}
    </span>
  );
}
