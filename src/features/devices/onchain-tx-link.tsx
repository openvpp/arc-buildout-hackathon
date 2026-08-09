import { ExternalLink } from '@/components/common/external-link';

import { arcTxExplorerUrl, isOnchainTxHash, truncateHash } from './format';

const defaultLinkClassName =
  'inline-flex w-fit items-center text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200';

/**
 * Shared Arcscan / plain-text presentation for on-chain transaction refs.
 */
export function OnchainTxLink({
  transactionHash,
  label,
  linkText,
  emptyLabel,
  plainFallback,
}: {
  readonly transactionHash: string | null | undefined;
  readonly label?: string;
  readonly linkText: string;
  readonly emptyLabel?: string;
  /** Shown when the ref is not a 0x…64 hash (e.g. Circle transfer UUID). */
  readonly plainFallback?: 'hash' | 'truncate' | 'null';
}) {
  if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
    if (emptyLabel === undefined) {
      return null;
    }
    return (
      <span className="text-xs text-slate-600 dark:text-slate-400">
        {emptyLabel}
      </span>
    );
  }

  if (isOnchainTxHash(transactionHash)) {
    return (
      <div className="flex flex-col gap-1">
        {label !== undefined ? (
          <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            {label}
          </span>
        ) : null}
        <ExternalLink
          href={arcTxExplorerUrl(transactionHash)}
          className={defaultLinkClassName}
        >
          {linkText}
        </ExternalLink>
        <p className="font-mono text-xs break-all text-slate-800 dark:text-slate-200">
          {transactionHash}
        </p>
      </div>
    );
  }

  if (plainFallback === 'null') {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      {label !== undefined ? (
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </span>
      ) : null}
      <p className="font-mono text-xs break-all text-slate-800 dark:text-slate-200">
        {plainFallback === 'truncate'
          ? truncateHash(transactionHash)
          : transactionHash}
      </p>
    </div>
  );
}
