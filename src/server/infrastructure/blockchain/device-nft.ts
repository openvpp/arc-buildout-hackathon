import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
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

const log = createServerLogger({ component: 'device-nft-minter' });

type ReceiptLog = Pick<Log, 'data' | 'topics'>;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function addressEquals(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Extract the minted token id from receipt logs (DeviceMinted, then TransferSingle). */
function extractTokenId(
  logs: ReceiptLog[],
  expected: { to: string },
): string | null {
  for (const entry of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DEVICE_NFT_ABI,
        data: entry.data,
        topics: entry.topics,
      });
      if (decoded.eventName === 'DeviceMinted') {
        const args = decoded.args as { tokenId: bigint; to: string };
        if (addressEquals(args.to, expected.to)) {
          return args.tokenId.toString();
        }
      }
    } catch {
      continue;
    }
  }
  for (const entry of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DEVICE_NFT_ABI,
        data: entry.data,
        topics: entry.topics,
      });
      if (decoded.eventName === 'TransferSingle') {
        const args = decoded.args as { from: string; to: string; id: bigint };
        if (
          addressEquals(args.from, ZERO_ADDRESS) &&
          addressEquals(args.to, expected.to)
        ) {
          return args.id.toString();
        }
      }
    } catch {
      continue;
    }
  }
  return null;
}

export type DeviceNftMinter = {
  mintDevice(input: {
    to: string;
    typeId: bigint;
    deviceURI: string;
    onBroadcast: (hash: string) => Promise<void>;
  }): Promise<{ tokenId: string; transactionHash: string }>;
  reconcileMint(input: {
    transactionHash: string;
    to: string;
    typeId: bigint;
  }): Promise<{ tokenId: string } | null>;
};

/** Returns null when Arc minting isn't configured — callers must not mint. */
export function createDeviceNftMinter(): DeviceNftMinter | null {
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
    async mintDevice(input) {
      const hash = await walletClient.writeContract({
        account,
        chain,
        address: contractAddress as `0x${string}`,
        abi: DEVICE_NFT_ABI,
        functionName: 'mintDevice',
        args: [input.to as `0x${string}`, input.typeId, input.deviceURI],
      });
      await input.onBroadcast(hash);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: env.ARC_REQUIRED_CONFIRMATIONS,
      });
      const tokenId = extractTokenId(receipt.logs, { to: input.to });
      if (tokenId === null) {
        throw new Error(`Could not extract token id from mint receipt ${hash}`);
      }
      return { tokenId, transactionHash: hash };
    },

    async reconcileMint(input) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: input.transactionHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          return null;
        }
        const tokenId = extractTokenId(receipt.logs, { to: input.to });
        return tokenId !== null ? { tokenId } : null;
      } catch (error) {
        log.warn('mint.reconcile_lookup_failed', {
          transactionHash: input.transactionHash,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
  };
}

export function buildSimpleDeviceMetadataUri(input: {
  vehicleId: string;
  displayName: string;
  make: string | null;
  model: string | null;
  year: number | null;
  walletAddress: string;
}): string {
  const json = JSON.stringify({
    vehicleId: input.vehicleId,
    name: input.displayName,
    make: input.make,
    model: input.model,
    year: input.year,
    owner: input.walletAddress,
  });
  return `data:application/json;base64,${Buffer.from(json).toString('base64')}`;
}
