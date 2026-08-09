import { OnchainTxLink } from './onchain-tx-link';

/**
 * Shows DeviceNFT recordDeviceEvent / provenance tx on Arcscan when the ref is
 * an on-chain hash. Otherwise plain text (never a broken explorer link).
 */
export function DeviceEventTransactionLink({
  transactionHash,
}: {
  readonly transactionHash: string | null | undefined;
}) {
  return (
    <OnchainTxLink
      transactionHash={transactionHash}
      label="Device event tx"
      linkText="View on Arcscan"
      emptyLabel="No on-chain event yet"
      plainFallback="hash"
    />
  );
}
