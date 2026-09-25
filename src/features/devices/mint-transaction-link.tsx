import { env } from '@/config/env';

import { truncateHash } from './format';

/** Links to the Arc explorer for a DeviceNFT mint tx. Renders nothing pre-broadcast. */
export function MintTransactionLink({
  transactionHash,
}: {
  transactionHash: string | null;
}) {
  if (transactionHash === null || transactionHash.length === 0) {
    return null;
  }
  const href = `${env.NEXT_PUBLIC_ARC_EXPLORER_BASE_URL.replace(/\/$/, '')}/tx/${transactionHash}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-xs font-medium text-white/70 underline decoration-dotted"
    >
      {truncateHash(transactionHash)}
    </a>
  );
}
