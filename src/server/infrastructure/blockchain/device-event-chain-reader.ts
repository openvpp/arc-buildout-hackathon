import {
  BlockNotFoundError,
  createPublicClient,
  hexToString,
  http,
  keccak256,
  parseAbiItem,
  TransactionNotFoundError,
  type PublicClient,
} from 'viem';

import {
  createArcHttpTransport,
  resolveVerifierRpcUrl,
} from '@/server/infrastructure/blockchain/network-provider';
import { getServerEnv } from '@/server/config/env';

/** Public RPCs reject `eth_getLogs` ranges much above this. */
export const MAX_LOG_RANGE_BLOCKS = 2_000n;

const READ_TIMEOUT_MS = 20_000;
/** viem's own HTTP retries; history misses are retried below instead. */
const TRANSPORT_RETRY_COUNT = 1;

/** Same signature as DEVICE_NFT_ABI's DeviceEvent (verified on-chain). */
const DEVICE_EVENT = parseAbiItem(
  'event DeviceEvent(uint256 indexed tokenId, uint8 indexed eventType, bytes data, uint256 timestamp)',
);

export type ChainDeviceEventLog = {
  contractAddress: string;
  blockNumber: bigint;
  transactionHash: string;
  logIndex: number;
  tokenId: bigint;
  eventType: number;
  dataHash: string;
  dataUtf8: string | null;
  /** The event's own `timestamp` argument (block time, seconds). */
  eventTimestamp: bigint;
};

export type ChainBlock = {
  number: bigint;
  timestamp: bigint;
  /** Sender of a transaction in this block, or null if not in it. */
  senderOf(transactionHash: string): string | null;
};

/**
 * Read-only view of DeviceNFT events. Reads by block, not by transaction
 * hash: Arc's public RPCs drop the hash index for older transactions while
 * still serving their blocks and logs.
 */
export type DeviceEventChainReader = {
  chainId: bigint;
  /** Host of the RPC used, recorded as evidence (never the full URL). */
  rpcHost: string;
  latestBlockNumber(): Promise<bigint>;
  /**
   * Null only when the chain says the block does not exist. Any failure to
   * read (timeout, rate limit, missing history) throws, so the caller never
   * mistakes an unreachable RPC for a missing anchor.
   */
  readBlock(blockNumber: bigint): Promise<ChainBlock | null>;
  readDeviceEventLogs(input: {
    contractAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
    tokenId?: bigint;
  }): Promise<ChainDeviceEventLog[]>;
  /** Null when the RPC does not know (or no longer indexes) this hash; throws when it cannot be read. */
  findTransactionBlock(transactionHash: string): Promise<bigint | null>;
};

const HISTORY_MISS =
  /requested data not available|header not found|missing trie node/i;

/** A miss on one node of a load-balanced RPC; another node may serve it. */
function isHistoryMiss(error: unknown): boolean {
  return (
    error instanceof BlockNotFoundError ||
    (error instanceof Error && HISTORY_MISS.test(error.message))
  );
}

/**
 * Arc's public RPCs load-balance over nodes with different history
 * retention: an old-block read can fail with "requested data not available"
 * on one node and succeed on the next. Retry only those misses; timeouts and
 * rate limits fail fast (the job retries with backoff), so retries never
 * stack on top of the transport's own.
 */
async function withHistoryRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!isHistoryMiss(error)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

function utf8OrNull(hex: `0x${string}`): string | null {
  try {
    return hexToString(hex);
  } catch {
    return null;
  }
}

export function createDeviceEventChainReader(
  clientOverride?: PublicClient,
): DeviceEventChainReader {
  const env = getServerEnv();
  const url = resolveVerifierRpcUrl(env);
  const separateVerifier =
    env.VERIFIER_RPC_URL !== undefined && env.VERIFIER_RPC_URL.length > 0;
  const client =
    clientOverride ??
    createPublicClient({
      transport: separateVerifier
        ? http(url, {
            timeout: READ_TIMEOUT_MS,
            retryCount: TRANSPORT_RETRY_COUNT,
          })
        : createArcHttpTransport(env, {
            timeout: READ_TIMEOUT_MS,
            retryCount: TRANSPORT_RETRY_COUNT,
          }),
    });

  return {
    chainId: BigInt(env.ARC_CHAIN_ID),
    rpcHost: new URL(url).host,

    latestBlockNumber: () => client.getBlockNumber(),

    async readBlock(blockNumber) {
      try {
        const block = await withHistoryRetry(() =>
          client.getBlock({ blockNumber, includeTransactions: true }),
        );
        const senders = new Map(
          block.transactions.map((tx) => [tx.hash.toLowerCase(), tx.from]),
        );
        return {
          number: block.number,
          timestamp: block.timestamp,
          senderOf: (hash) => senders.get(hash.toLowerCase()) ?? null,
        };
      } catch (error) {
        if (error instanceof BlockNotFoundError) {
          return null;
        }
        throw error;
      }
    },

    async readDeviceEventLogs(input) {
      if (input.toBlock - input.fromBlock + 1n > MAX_LOG_RANGE_BLOCKS) {
        throw new Error(
          `Log range exceeds ${MAX_LOG_RANGE_BLOCKS} blocks; page the request.`,
        );
      }
      const logs = await withHistoryRetry(() =>
        client.getLogs({
          address: input.contractAddress as `0x${string}`,
          event: DEVICE_EVENT,
          args:
            input.tokenId === undefined
              ? undefined
              : { tokenId: input.tokenId },
          fromBlock: input.fromBlock,
          toBlock: input.toBlock,
        }),
      );
      return logs.flatMap((entry) => {
        const { tokenId, eventType, data, timestamp } = entry.args;
        if (
          tokenId === undefined ||
          eventType === undefined ||
          data === undefined ||
          timestamp === undefined ||
          entry.transactionHash === null ||
          entry.blockNumber === null ||
          entry.logIndex === null
        ) {
          return [];
        }
        return [
          {
            contractAddress: entry.address,
            blockNumber: entry.blockNumber,
            transactionHash: entry.transactionHash,
            logIndex: entry.logIndex,
            tokenId,
            eventType,
            dataHash: keccak256(data),
            dataUtf8: utf8OrNull(data),
            eventTimestamp: timestamp,
          },
        ];
      });
    },

    async findTransactionBlock(transactionHash) {
      try {
        const tx = await client.getTransaction({
          hash: transactionHash as `0x${string}`,
        });
        return tx.blockNumber;
      } catch (error) {
        if (error instanceof TransactionNotFoundError) {
          return null;
        }
        throw error;
      }
    },
  };
}
