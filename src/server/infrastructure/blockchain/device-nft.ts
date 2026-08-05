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

/**
 * Extract minted token id from DeviceNFT receipt logs.
 * Prefers DeviceMinted, then ERC-1155 TransferSingle, then ERC-721 Transfer.
 */
export function extractDeviceNftTokenIdFromLogs(
  logs: readonly ReceiptLog[],
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
        return decoded.args.tokenId.toString(10);
      }
      if (
        decoded.eventName === 'TransferSingle' &&
        transferSingleId === undefined
      ) {
        transferSingleId = decoded.args.id.toString(10);
      }
      if (decoded.eventName === 'Transfer' && erc721TokenId === undefined) {
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
      log.info('device_nft.mock_minted', { tokenId, transactionHash });
      return { tokenId, transactionHash };
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

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new Error(`DeviceNFT mint transaction failed: ${hash}`);
      }

      const tokenId = extractDeviceNftTokenIdFromLogs(receipt.logs);
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
