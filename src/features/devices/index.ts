/** Public surface of the devices feature. */
export { PLACEHOLDER_DEVICES } from './placeholders';
export { DeviceEventTransactionLink } from './device-event-transaction-link';
export { DeviceMintTransactionLink } from './device-mint-transaction-link';
export { SettlementPaymentRef } from './settlement-payment-ref';
export {
  arcTxExplorerUrl,
  deviceDisplayName,
  deviceStatusTone,
  formatTimestamp,
  isOnchainTxHash,
  mintStatusTone,
  readDeviceMetadata,
  truncateHash,
} from './format';

/**
 * Server Component loaders (`load-device-detail.ts`) stay out of this barrel so
 * client-safe format helpers can be imported without pulling `server-only`.
 */
