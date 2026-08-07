import { z } from 'zod';

import { CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL } from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'circle-x402-transfer' });

const transferResponseSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  txHash: z.string().nullable().optional(),
  transactionHash: z.string().nullable().optional(),
});

const ONCHAIN_TX_RE = /^0x[a-fA-F0-9]{64}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOnchainTxHash(value: string): boolean {
  return ONCHAIN_TX_RE.test(value.trim());
}

export function isCircleTransferUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/**
 * Look up a Circle Gateway x402 transfer by UUID and return its batch settlement
 * tx hash when Circle has assigned one.
 * @see https://developers.circle.com/api-reference/gateway/all/get-x402transfer-by-id
 */
export async function resolveCircleX402TransferTxHash(
  transferId: string,
): Promise<string | null> {
  const env = getServerEnv();
  const authToken = env.CIRCLE_GATEWAY_AUTH_TOKEN;
  if (authToken === undefined || authToken.length === 0) {
    log.info('circle.transfer_lookup_skipped', {
      reason: 'missing_auth_token',
    });
    return null;
  }

  const baseUrl = (
    env.CIRCLE_GATEWAY_FACILITATOR_URL !== undefined &&
    env.CIRCLE_GATEWAY_FACILITATOR_URL.length > 0
      ? env.CIRCLE_GATEWAY_FACILITATOR_URL
      : CIRCLE_GATEWAY_FACILITATOR_DEFAULT_URL
  ).replace(/\/$/, '');

  const url = `${baseUrl}/v1/x402/transfers/${encodeURIComponent(transferId.trim())}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      log.warn('circle.transfer_lookup_failed', {
        status: response.status,
        transferId,
      });
      return null;
    }

    const json: unknown = await response.json();
    // Some gateways wrap in { data: ... }
    const nested =
      typeof json === 'object' && json !== null && 'data' in json
        ? Reflect.get(json, 'data')
        : undefined;
    const payload =
      typeof nested === 'object' && nested !== null ? nested : json;

    const parsed = transferResponseSchema.safeParse(payload);
    if (!parsed.success) {
      log.warn('circle.transfer_lookup_shape', { transferId });
      return null;
    }

    const candidate = parsed.data.txHash ?? parsed.data.transactionHash;
    if (typeof candidate !== 'string' || !isOnchainTxHash(candidate)) {
      log.info('circle.transfer_tx_pending', {
        transferId,
        status: parsed.data.status,
      });
      return null;
    }

    return candidate.toLowerCase();
  } catch (error: unknown) {
    log.warn('circle.transfer_lookup_error', {
      transferId,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
