import { decodeEventLog, hexToString, keccak256, pad, toHex } from 'viem';
import { z } from 'zod';

import { defaultArcExplorerApiUrl } from '@/config/arc-network';
import { getServerEnv } from '@/server/config/env';
import type { ChainDeviceEventLog } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import {
  DEVICE_EVENT_ABI_ITEM,
  DEVICE_EVENT_TOPIC0,
} from '@/server/infrastructure/blockchain/device-nft-abi';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'blockscout-client' });

const EXPLORER_TIMEOUT_MS = 20_000;

const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const logSchema = z.object({
  address: z.string(),
  blockNumber: hex,
  data: hex,
  logIndex: hex,
  timeStamp: hex.optional(),
  topics: z.array(hex.nullable()),
  transactionHash: hex,
});
/** Etherscan-style error messages that mean "you are being refused". */
const REFUSED_MESSAGE = /rate limit|api key|apikey|forbidden|too many/i;

const responseSchema = z.object({
  status: z.string(),
  message: z.string().optional(),
  result: z.union([z.array(z.unknown()), z.string(), z.null()]),
});

export type ExplorerLogsResult =
  | {
      ok: true;
      logs: (ChainDeviceEventLog & { blockTimestamp: Date | null })[];
    }
  | { ok: false; reason: 'unavailable' | 'blocked' };

function utf8OrNull(data: `0x${string}`): string | null {
  try {
    return hexToString(data);
  } catch {
    return null;
  }
}

/**
 * Discovery only: a token's DeviceEvent history from the chain explorer's
 * Etherscan-compatible API, in one call (RPC log ranges are capped at ~2k
 * blocks). Results are never trusted as proof — verification re-reads each
 * anchor by block from an RPC.
 */
export async function fetchTokenDeviceEventsFromExplorer(input: {
  contractAddress: string;
  tokenId: bigint;
}): Promise<ExplorerLogsResult> {
  const env = getServerEnv();
  const base =
    env.ARC_EXPLORER_API_URL !== undefined &&
    env.ARC_EXPLORER_API_URL.length > 0
      ? env.ARC_EXPLORER_API_URL
      : defaultArcExplorerApiUrl(env.ARC_CHAIN_ID);
  if (base === null) {
    return { ok: false, reason: 'unavailable' };
  }
  const url = new URL(base);
  // Set each parameter, keeping anything already in the configured URL
  // (e.g. an apikey).
  for (const [key, value] of Object.entries({
    module: 'logs',
    action: 'getLogs',
    address: input.contractAddress,
    topic0: DEVICE_EVENT_TOPIC0,
    topic1: pad(toHex(input.tokenId), { size: 32 }),
    topic0_1_opr: 'and',
    fromBlock: '0',
    toBlock: 'latest',
  })) {
    url.searchParams.set(key, value);
  }

  let body: unknown;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (response.status === 403 || response.status === 429) {
      log.warn('explorer.blocked', { status: response.status, host: url.host });
      return { ok: false, reason: 'blocked' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'unavailable' };
    }
    body = (await response.json()) as unknown;
  } catch (error) {
    log.warn('explorer.request_failed', {
      host: url.host,
      errorName: error instanceof Error ? error.name : 'unknown',
    });
    return { ok: false, reason: 'unavailable' };
  }

  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: 'unavailable' };
  }
  // Blockscout answers "No logs found" with status "0" and an empty list
  // (handled below). Status "0" with anything else is an error — a bad
  // request, a rate limit, a missing key — never "no events".
  if (!Array.isArray(parsed.data.result)) {
    const message = `${parsed.data.message ?? ''} ${typeof parsed.data.result === 'string' ? parsed.data.result : ''}`;
    log.warn('explorer.error_response', {
      host: url.host,
      status: parsed.data.status,
    });
    return {
      ok: false,
      reason: REFUSED_MESSAGE.test(message) ? 'blocked' : 'unavailable',
    };
  }

  const logs: (ChainDeviceEventLog & { blockTimestamp: Date | null })[] = [];
  for (const raw of parsed.data.result) {
    const entry = logSchema.safeParse(raw);
    if (!entry.success) {
      continue;
    }
    const [topic0, ...rest] = entry.data.topics.filter(
      (topic): topic is `0x${string}` => topic !== null,
    );
    if (topic0 === undefined) {
      continue;
    }
    const topics: [`0x${string}`, ...`0x${string}`[]] = [topic0, ...rest];
    try {
      const decoded = decodeEventLog({
        abi: [DEVICE_EVENT_ABI_ITEM],
        data: entry.data.data as `0x${string}`,
        topics,
      });
      logs.push({
        contractAddress: entry.data.address,
        blockNumber: BigInt(entry.data.blockNumber),
        transactionHash: entry.data.transactionHash.toLowerCase(),
        logIndex: Number(BigInt(entry.data.logIndex)),
        tokenId: decoded.args.tokenId,
        eventType: decoded.args.eventType,
        dataHash: keccak256(decoded.args.data),
        dataUtf8: utf8OrNull(decoded.args.data),
        eventTimestamp: decoded.args.timestamp,
        blockTimestamp:
          entry.data.timeStamp !== undefined
            ? new Date(Number(BigInt(entry.data.timeStamp)) * 1000)
            : null,
      });
    } catch {
      continue;
    }
  }
  return { ok: true, logs };
}
