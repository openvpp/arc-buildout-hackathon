import { ExternalLink } from '@/components/common/external-link';

import { arcTxExplorerUrl, isOnchainTxHash } from './format';

/**
 * Shows DeviceNFT recordDeviceEvent / provenance tx on Arcscan when the ref is
 * an on-chain hash. Otherwise plain text (never a broken explorer link).
 */
export function DeviceEventTransactionLink({
  transactionHash,
}: {
  readonly transactionHash: string | null | undefined;
}) {
  if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
    return (
      <span className="text-xs text-slate-600 dark:text-slate-400">
        No on-chain event yet
      </span>
    );
  }

  if (isOnchainTxHash(transactionHash)) {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          Device event tx
        </span>
        <ExternalLink
          href={arcTxExplorerUrl(transactionHash)}
          className="inline-flex w-fit items-center text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200"
        >
          View on Arcscan
        </ExternalLink>
        <p className="font-mono text-xs break-all text-slate-800 dark:text-slate-200">
          {transactionHash}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">
        Device event tx
      </span>
      <p className="font-mono text-xs break-all text-slate-800 dark:text-slate-200">
        {transactionHash}
      </p>
    </div>
  );
}
