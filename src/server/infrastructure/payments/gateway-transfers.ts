import { z } from 'zod';

import type { ArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';

/**
 * Circle Gateway's record of one x402 transfer (GET /v1/x402/transfers/:id,
 * no API key needed). Lifecycle: received → batched → confirmed →
 * completed | failed; `txHash` is the batch settlement transaction on Arc,
 * shared by every transfer in the batch.
 */
export type GatewayTransfer = {
  status: string;
  txHash: string | null;
};

/** Looks up a transfer; null when Gateway does not know it (yet). */
export type GatewayTransferLookup = (
  transferId: string,
) => Promise<GatewayTransfer | null>;

const transferSchema = z
  .object({
    status: z.string(),
    txHash: z.string().nullable().optional(),
  })
  .passthrough();

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const LOOKUP_TIMEOUT_MS = 15_000;

export function createGatewayTransferLookup(
  network: ArcPaymentNetwork,
  fetchImpl: typeof fetch = fetch,
): GatewayTransferLookup {
  const base = network.facilitatorUrl.replace(/\/$/, '');
  return async (transferId) => {
    const response = await fetchImpl(
      `${base}/v1/x402/transfers/${encodeURIComponent(transferId)}`,
      {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`Gateway transfer lookup failed (${response.status}).`);
    }
    const parsed = transferSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Gateway transfer lookup returned an unexpected shape.');
    }
    const txHash = parsed.data.txHash ?? null;
    return {
      status: parsed.data.status,
      txHash:
        txHash !== null && TX_HASH.test(txHash) ? txHash.toLowerCase() : null,
    };
  };
}

export type SettlementOutcome =
  | { kind: 'settled'; txHash: string }
  | { kind: 'failed' }
  | { kind: 'pending' };

/**
 * What a transfer means for our record. Settled only with a batch
 * transaction in hand — never on a status alone.
 */
export function settlementOutcome(
  transfer: GatewayTransfer | null,
): SettlementOutcome {
  if (transfer === null) {
    return { kind: 'pending' };
  }
  if (transfer.status === 'failed') {
    return { kind: 'failed' };
  }
  if (
    (transfer.status === 'completed' || transfer.status === 'confirmed') &&
    transfer.txHash !== null
  ) {
    return { kind: 'settled', txHash: transfer.txHash };
  }
  return { kind: 'pending' };
}
