import { StatusBadge } from '@/components/ui/status-badge';
import { TransactionLink } from '@/features/devices/transaction-link';

/**
 * Where a payment stands. "Accepted" means Circle Gateway took it (funds
 * locked, content revealed); "Settled" only once its batch confirmed on Arc,
 * and only then is there a transaction to link.
 */
export function SettlementBadge({
  status,
  settlementTxHash,
}: {
  readonly status: string;
  readonly settlementTxHash: string | null;
}) {
  if (status === 'settled') {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <StatusBadge tone="success">Settled on Arc</StatusBadge>
        <TransactionLink transactionHash={settlementTxHash} />
      </span>
    );
  }
  if (status === 'failed') {
    return <StatusBadge tone="danger">Settlement failed</StatusBadge>;
  }
  return (
    <span title="Circle Gateway accepted the payment; it settles on Arc in the next batch.">
      <StatusBadge tone="warning">Accepted · settling</StatusBadge>
    </span>
  );
}
