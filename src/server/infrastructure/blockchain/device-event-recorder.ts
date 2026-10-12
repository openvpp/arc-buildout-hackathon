import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  keccak256,
  stringToHex,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getServerEnv } from '@/server/config/env';
import { DEVICE_NFT_ABI } from '@/server/infrastructure/blockchain/device-nft-abi';
import {
  createArcHttpTransport,
  createArcMintChain,
  isDeviceNftMintConfigured,
  resolveDeviceNftMinterPrivateKey,
} from '@/server/infrastructure/blockchain/network-provider';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'device-event-recorder' });

const EVENT_RECEIPT_TIMEOUT_MS = 180_000;

type ReceiptLog = Pick<Log, 'address' | 'data' | 'topics'>;

export type ExpectedDeviceEvent = {
  tokenId: bigint;
  eventType: number;
  /** keccak256 of the exact UTF-8 payload sent as `data`. */
  payloadHash: string;
};

/**
 * True when the receipt carries the DeviceEvent we sent: emitted by our
 * contract, for this token and event type, with byte-identical data.
 */
export function receiptHasDeviceEvent(
  logs: ReceiptLog[],
  contractAddress: string,
  expected: ExpectedDeviceEvent,
): boolean {
  for (const entry of logs) {
    if (entry.address.toLowerCase() !== contractAddress.toLowerCase()) {
      continue;
    }
    try {
      const decoded = decodeEventLog({
        abi: DEVICE_NFT_ABI,
        data: entry.data,
        topics: entry.topics,
      });
      if (decoded.eventName !== 'DeviceEvent') {
        continue;
      }
      if (
        decoded.args.tokenId === expected.tokenId &&
        decoded.args.eventType === expected.eventType &&
        keccak256(decoded.args.data).toLowerCase() ===
          expected.payloadHash.toLowerCase()
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

/** keccak256 of the payload's UTF-8 bytes — what `device_events.payload_hash` stores. */
export function hashDeviceEventPayload(payloadJson: string): string {
  return keccak256(stringToHex(payloadJson));
}

export type DeviceEventRecorder = {
  chainId: bigint;
  contractAddress: string;
  recordDeviceEvent(input: {
    tokenId: bigint;
    eventType: number;
    payloadJson: string;
    payloadHash: string;
    onBroadcast: (hash: string) => Promise<void>;
  }): Promise<
    | { outcome: 'confirmed'; transactionHash: string; blockNumber: bigint }
    | { outcome: 'reverted'; transactionHash: string }
  >;
  reconcileDeviceEvent(
    input: ExpectedDeviceEvent & { transactionHash: string },
  ): Promise<
    | { outcome: 'confirmed'; blockNumber: bigint }
    | { outcome: 'reverted' }
    | { outcome: 'pending' }
    | { outcome: 'unrecognized' }
  >;
};

/**
 * Returns null when Arc writes aren't configured — callers must not record.
 * Signs with the same key as the minter, which must hold UPDATER_ROLE.
 */
export function createDeviceEventRecorder(): DeviceEventRecorder | null {
  const env = getServerEnv();
  if (!isDeviceNftMintConfigured(env)) {
    return null;
  }
  const privateKey = resolveDeviceNftMinterPrivateKey(env);
  const contractAddress = env.DEVICE_NFT_CONTRACT_ADDRESS;
  if (privateKey === null || contractAddress === undefined) {
    return null;
  }

  const chain = createArcMintChain(env);
  const transport = createArcHttpTransport(env);
  const account = privateKeyToAccount(privateKey);
  const publicClient: PublicClient = createPublicClient({ chain, transport });
  const walletClient: WalletClient = createWalletClient({
    account,
    chain,
    transport,
  });

  return {
    chainId: BigInt(env.ARC_CHAIN_ID),
    contractAddress,

    async recordDeviceEvent(input) {
      const hash = await walletClient.writeContract({
        account,
        chain,
        address: contractAddress as `0x${string}`,
        abi: DEVICE_NFT_ABI,
        functionName: 'recordDeviceEvent',
        args: [input.tokenId, input.eventType, stringToHex(input.payloadJson)],
      });
      await input.onBroadcast(hash);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: env.ARC_REQUIRED_CONFIRMATIONS,
        timeout: EVENT_RECEIPT_TIMEOUT_MS,
      });
      if (receipt.status !== 'success') {
        return { outcome: 'reverted', transactionHash: hash };
      }
      if (
        !receiptHasDeviceEvent(receipt.logs, contractAddress, {
          tokenId: input.tokenId,
          eventType: input.eventType,
          payloadHash: input.payloadHash,
        })
      ) {
        throw new Error(
          `Receipt ${hash} has no matching DeviceEvent log for token ${input.tokenId}`,
        );
      }
      return {
        outcome: 'confirmed',
        transactionHash: hash,
        blockNumber: receipt.blockNumber,
      };
    },

    async reconcileDeviceEvent(input) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: input.transactionHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          return { outcome: 'reverted' };
        }
        const confirmations = await publicClient.getTransactionConfirmations({
          transactionReceipt: receipt,
        });
        if (confirmations < BigInt(env.ARC_REQUIRED_CONFIRMATIONS)) {
          return { outcome: 'pending' };
        }
        return receiptHasDeviceEvent(receipt.logs, contractAddress, input)
          ? { outcome: 'confirmed', blockNumber: receipt.blockNumber }
          : { outcome: 'unrecognized' };
      } catch (error) {
        log.warn('device_event.reconcile_lookup_failed', {
          transactionHash: input.transactionHash,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return { outcome: 'pending' };
      }
    },
  };
}
