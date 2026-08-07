import { ExternalLink } from '@/components/common/external-link';
import { StatusBadge } from '@/components/ui/status-badge';

import { arcTxExplorerUrl, isOnchainTxHash } from './format';

/**
 * Renders a payment settlement ref: Arcscan link for on-chain hashes, or an
 * explicit pending state for Circle Gateway transfer UUIDs (not explorer links).
 */
export function SettlementPaymentRef({
  settlementRef,
  compact = false,
}: {
  readonly settlementRef: string;
  /** Tighter layout for history cards. */
  readonly compact?: boolean;
}) {
  if (isOnchainTxHash(settlementRef)) {
    return (
      <div className="flex flex-col gap-1">
        <span
          className={
            compact
              ? 'text-xs font-medium tracking-wide text-slate-500 uppercase'
              : 'text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80'
          }
        >
          Payment on Arcscan
        </span>
        <ExternalLink
          href={arcTxExplorerUrl(settlementRef)}
          className={
            compact
              ? 'inline-flex w-fit items-center text-xs font-medium text-slate-800 underline decoration-2 underline-offset-4 dark:text-slate-200'
              : 'inline-flex w-fit items-center font-semibold text-emerald-700 underline decoration-2 underline-offset-4 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100'
          }
        >
          View settlement transaction
        </ExternalLink>
        <p
          className={
            compact
              ? 'font-mono text-xs break-all text-slate-800 dark:text-slate-200'
              : 'font-mono text-[11px] break-all text-emerald-900/80 dark:text-emerald-100/80'
          }
        >
          {settlementRef}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="warning">Pending on-chain settlement</StatusBadge>
      </div>
      <span
        className={
          compact
            ? 'text-xs font-medium tracking-wide text-slate-500 uppercase'
            : 'text-[11px] font-medium tracking-wide text-emerald-800/80 uppercase dark:text-emerald-200/80'
        }
      >
        Circle transfer id
      </span>
      <p
        className={
          compact
            ? 'font-mono text-xs break-all text-slate-800 dark:text-slate-200'
            : 'font-mono text-[11px] break-all text-emerald-900/80 dark:text-emerald-100/80'
        }
      >
        {settlementRef}
      </p>
      <p
        className={
          compact
            ? 'text-xs text-slate-600 dark:text-slate-400'
            : 'text-emerald-900/80 dark:text-emerald-100/80'
        }
      >
        Gateway returned a transfer UUID — not an Arcscan transaction yet. A
        link appears once the on-chain settlement hash is available.
      </p>
    </div>
  );
}
