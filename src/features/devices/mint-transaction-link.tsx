import { TransactionLink } from './transaction-link';

/** Links to the Arc explorer for a DeviceNFT mint tx. Renders nothing pre-broadcast. */
export function MintTransactionLink({
  transactionHash,
}: {
  transactionHash: string | null;
}) {
  return <TransactionLink transactionHash={transactionHash} />;
}
