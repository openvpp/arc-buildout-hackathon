import { createHash } from 'node:crypto';

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getServerEnv } from '@/server/config/env';
import type { DeviceNftMinter } from '@/server/domain/shared/ports';
import { DEVICE_NFT_ABI } from '@/server/infrastructure/blockchain/device-nft-abi';
import {
  createArcMintChain,
  isDeviceNftMintConfigured,
  resolveDeviceNftMinterPrivateKey,
  resolveDeviceNftNetwork,
} from '@/server/infrastructure/blockchain/network-provider';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'device-nft' });

function mockTokenIdFor(deviceURI: string): string {
  const digest = createHash('sha256').update(`mock-nft:${deviceURI}`).digest();
  return BigInt(`0x${digest.subarray(0, 8).toString('hex')}`).toString(10);
}

function mockTxHashFor(deviceURI: string): string {
  return `0x${createHash('sha256')
    .update(`mock-nft-tx:${deviceURI}`)
    .digest('hex')}`;
}

type ReceiptLog = Pick<Log, 'data' | 'topics'>;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function addressEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Extract minted token id from DeviceNFT receipt logs.
 * Prefers DeviceMinted, then ERC-1155 TransferSingle, then ERC-721 Transfer.
 *
 * When `expected` is provided, only accept events whose recipient (and, for
 * DeviceMinted, `typeId`) match the mint arguments — so a receipt that also
 * carries unrelated transfers can't yield the wrong token id. TransferSingle /
 * ERC-721 Transfer additionally require a mint (`from == 0x0`).
 */
export function extractDeviceNftTokenIdFromLogs(
  logs: readonly ReceiptLog[],
  expected?: { to: string; typeId: bigint },
): string | undefined {
  let transferSingleId: string | undefined;
  let erc721TokenId: string | undefined;

  for (const logItem of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DEVICE_NFT_ABI,
        data: logItem.data,
        topics: logItem.topics,
      });
      if (decoded.eventName === 'DeviceMinted') {
        if (
          expected !== undefined &&
          (!addressEquals(decoded.args.to, expected.to) ||
            decoded.args.typeId !== expected.typeId)
        ) {
          continue;
        }
        return decoded.args.tokenId.toString(10);
      }
      if (
        decoded.eventName === 'TransferSingle' &&
        transferSingleId === undefined
      ) {
        if (
          expected !== undefined &&
          (!addressEquals(decoded.args.from, ZERO_ADDRESS) ||
            !addressEquals(decoded.args.to, expected.to))
        ) {
          continue;
        }
        transferSingleId = decoded.args.id.toString(10);
      }
      if (decoded.eventName === 'Transfer' && erc721TokenId === undefined) {
        if (
          expected !== undefined &&
          (!addressEquals(decoded.args.from, ZERO_ADDRESS) ||
            !addressEquals(decoded.args.to, expected.to))
        ) {
          continue;
        }
        erc721TokenId = decoded.args.tokenId.toString(10);
      }
    } catch {
      /* unrelated log */
    }
  }

  return transferSingleId ?? erc721TokenId;
}

export function createMockDeviceNftMinter(): DeviceNftMinter {
  if (!getServerEnv().ALLOW_MOCK_ADAPTERS) {
    throw new Error(
      'Mock DeviceNftMinter is forbidden unless ALLOW_MOCK_ADAPTERS=true',
    );
  }
  return {
    async mintDevice(input) {
      const tokenId = mockTokenIdFor(input.deviceURI);
      const transactionHash = mockTxHashFor(input.deviceURI);
      if (input.onBroadcast !== undefined) {
        await input.onBroadcast(transactionHash);
      }
      log.info('device_nft.mock_minted', { tokenId, transactionHash });
      return { tokenId, transactionHash };
    },
    // A mock tx never lands on-chain, so there is nothing to reconcile against;
    // returning null lets the caller (re)mint deterministically in demo/test.
    async reconcileMint() {
      return null;
    },
  };
}

export function createLiveDeviceNftMinter(input?: {
  publicClient?: PublicClient;
  walletClient?: WalletClient;
}): DeviceNftMinter {
  const env = getServerEnv();

  if (resolveDeviceNftNetwork(env) !== 'arc') {
    throw new Error(
      'DeviceNFT mint requires USE_ARC_NETWORK=true, ARC_RPC_URL, and ARC_AUTH_TOKEN',
    );
  }
  if (!isDeviceNftMintConfigured(env)) {
    throw new Error(
      'DEVICE_NFT_CONTRACT_ADDRESS and PRIVATE_KEY (or DEVICE_NFT_MINTER_PRIVATE_KEY) are required for live mint',
    );
  }

  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
    throw new Error(
      'Live DeviceNFT mint via env private key is not supported in production/staging',
    );
  }

  const contractAddress = env.DEVICE_NFT_CONTRACT_ADDRESS as `0x${string}`;
  const privateKey = resolveDeviceNftMinterPrivateKey(env);
  if (privateKey === null) {
    throw new Error('DeviceNFT minter private key is not configured');
  }
  const chain = createArcMintChain(env);
  const account = privateKeyToAccount(privateKey);
  const publicClient =
    input?.publicClient ??
    createPublicClient({
      chain,
      transport: http(env.ARC_RPC_URL),
    });
  const walletClient =
    input?.walletClient ??
    createWalletClient({
      account,
      chain,
      transport: http(env.ARC_RPC_URL),
    });

  return {
    async mintDevice(mintInput) {
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: DEVICE_NFT_ABI,
        functionName: 'mintDevice',
        args: [
          mintInput.to as `0x${string}`,
          mintInput.typeId,
          mintInput.deviceURI,
        ],
        account,
        chain,
      });

      // Surface the hash the instant it is broadcast so the caller can persist
      // it before we block on confirmation — a crash after this point must
      // reconcile against the in-flight tx, never re-mint.
      if (mintInput.onBroadcast !== undefined) {
        await mintInput.onBroadcast(hash);
      }

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`DeviceNFT mint transaction failed: ${hash}`);
      }

      const tokenId = extractDeviceNftTokenIdFromLogs(receipt.logs, {
        to: mintInput.to,
        typeId: mintInput.typeId,
      });
      if (tokenId === undefined) {
        throw new Error(
          `DeviceNFT mint succeeded but mint events missing: ${hash}`,
        );
      }

      log.info('device_nft.minted', {
        tokenId,
        transactionHash: hash,
        to: mintInput.to,
      });
      return { tokenId, transactionHash: hash };
    },

    async reconcileMint(reconcileInput) {
      const receipt = await publicClient
        .getTransactionReceipt({
          hash: reconcileInput.transactionHash as `0x${string}`,
        })
        .catch(() => null);
      // Pending, dropped, or reverted — caller may safely (re)mint.
      if (receipt === null || receipt.status !== 'success') {
        return null;
      }
      const tokenId = extractDeviceNftTokenIdFromLogs(receipt.logs, {
        to: reconcileInput.to,
        typeId: reconcileInput.typeId,
      });
      return tokenId === undefined ? null : { tokenId };
    },
  };
}

export function createDeviceNftMinter(): DeviceNftMinter | null {
  const env = getServerEnv();
  if (env.ALLOW_MOCK_ADAPTERS) {
    return createMockDeviceNftMinter();
  }
  if (!isDeviceNftMintConfigured(env)) {
    return null;
  }
  return createLiveDeviceNftMinter();
}

export function buildSimpleDeviceMetadataUri(input: {
  vehicleId: string;
  displayName: string;
  make: string | null;
  model: string | null;
  year: number | null;
  walletAddress: string;
}): string {
  const payload = {
    name: input.displayName,
    description: 'Enode-linked EV device registry (Arc DeviceNFT)',
    attributes: [
      { trait_type: 'vehicleId', value: input.vehicleId },
      { trait_type: 'wallet', value: input.walletAddress },
      ...(input.make !== null
        ? [{ trait_type: 'make', value: input.make }]
        : []),
      ...(input.model !== null
        ? [{ trait_type: 'model', value: input.model }]
        : []),
      ...(input.year !== null
        ? [{ trait_type: 'year', value: String(input.year) }]
        : []),
    ],
  };
  return `data:application/json;base64,${Buffer.from(
    JSON.stringify(payload),
    'utf8',
  ).toString('base64')}`;
}
