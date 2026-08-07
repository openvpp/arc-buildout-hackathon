import { createHash } from 'node:crypto';

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Hex,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getServerEnv } from '@/server/config/env';
import type { ProvenanceAnchor } from '@/server/domain/shared/ports';
import {
  DEVICE_EVENT_TYPE_TELEMETRY_HASH,
  DEVICE_NFT_ABI,
} from '@/server/infrastructure/blockchain/device-nft-abi';
import {
  createArcMintChain,
  isDeviceNftMintConfigured,
  resolveDeviceNftMinterPrivateKey,
} from '@/server/infrastructure/blockchain/network-provider';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'provenance-anchor' });

const MOCK_PROVENANCE_VERSION = 'mock-device-event-v1';

/** Normalize a SHA-256 hex digest to `0x`-prefixed bytes32. */
export function toBytes32ContentHash(contentHash: string): Hex {
  const normalized = contentHash.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error('contentHash must be a 32-byte hex digest');
  }
  return `0x${normalized}`;
}

function mockTxHashFor(contentHash: string): string {
  return `0x${createHash('sha256')
    .update(`mock-anchor:${contentHash}`)
    .digest('hex')}`;
}

/**
 * Mock provenance for CI / ALLOW_MOCK_ADAPTERS demos.
 * Never use in production — invents confirmation without Arc.
 */
export function createMockProvenanceAnchor(): ProvenanceAnchor {
  if (!getServerEnv().ALLOW_MOCK_ADAPTERS) {
    throw new Error(
      'Mock ProvenanceAnchor is forbidden unless ALLOW_MOCK_ADAPTERS=true',
    );
  }

  return {
    async anchorTelemetry(input) {
      const transactionHash = mockTxHashFor(input.contentHash);
      log.info('provenance.mock_submitted', {
        telemetryRecordId: input.telemetryRecordId,
        tokenId: input.tokenId,
        transactionHash,
        abiVersion: MOCK_PROVENANCE_VERSION,
      });
      return { status: 'submitted', transactionHash };
    },
    async getAnchorStatus(input) {
      return {
        status: 'anchored',
        transactionHash: mockTxHashFor(input.contentHash),
      };
    },
    async verifyAnchor() {
      return { valid: true };
    },
  };
}

/**
 * Live provenance via DeviceNFT.recordDeviceEvent (content hash in `data`).
 * Signer must hold UPDATER_ROLE on the DeviceNFT contract.
 */
export function createLiveDeviceNftProvenanceAnchor(input?: {
  publicClient?: PublicClient;
  walletClient?: WalletClient;
}): ProvenanceAnchor {
  const env = getServerEnv();
  const contractAddress = env.DEVICE_NFT_CONTRACT_ADDRESS;
  if (contractAddress === undefined || contractAddress.length === 0) {
    throw new Error(
      'DEVICE_NFT_CONTRACT_ADDRESS is required for DeviceNFT provenance',
    );
  }

  const rpcUrl = env.ARC_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error('ARC_RPC_URL is required for DeviceNFT provenance');
  }

  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
    throw new Error(
      'Live DeviceNFT provenance signer via env private key is not supported in production/staging. Use KMS.',
    );
  }

  const privateKey = resolveDeviceNftMinterPrivateKey(env);
  if (privateKey === null) {
    throw new Error(
      'DEVICE_NFT_MINTER_PRIVATE_KEY or PRIVATE_KEY is required for DeviceNFT provenance',
    );
  }

  const account = privateKeyToAccount(privateKey);
  const chain = createArcMintChain(env);

  const publicClient =
    input?.publicClient ??
    createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

  const walletClient =
    input?.walletClient ??
    createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    });

  return {
    async anchorTelemetry(anchorInput) {
      const tokenId = BigInt(anchorInput.tokenId);
      const hashBytes = toBytes32ContentHash(anchorInput.contentHash);
      const hash = await walletClient.writeContract({
        address: contractAddress as Hex,
        abi: DEVICE_NFT_ABI,
        functionName: 'recordDeviceEvent',
        args: [tokenId, DEVICE_EVENT_TYPE_TELEMETRY_HASH, hashBytes],
        account,
        chain,
      });
      log.info('provenance.device_event_submitted', {
        telemetryRecordId: anchorInput.telemetryRecordId,
        tokenId: anchorInput.tokenId,
        transactionHash: hash,
        eventType: DEVICE_EVENT_TYPE_TELEMETRY_HASH,
      });
      return { status: 'submitted', transactionHash: hash.toLowerCase() };
    },

    async getAnchorStatus(statusInput) {
      void statusInput;
      return { status: 'pending' };
    },

    async verifyAnchor(verifyInput) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: verifyInput.anchorTransactionHash as Hex,
        });
        if (receipt.status !== 'success') {
          return {
            valid: false,
            reason: 'Device event transaction failed on-chain',
          };
        }
        const expected = toBytes32ContentHash(verifyInput.contentHash);
        if (!receiptHasTelemetryContentHash(receipt.logs, expected)) {
          log.warn('provenance.device_event_log_missing', {
            transactionHash: verifyInput.anchorTransactionHash,
          });
        }
        return { valid: true };
      } catch {
        return {
          valid: false,
          reason: 'Device event transaction receipt not found',
        };
      }
    },
  };
}

export function receiptHasTelemetryContentHash(
  logs: readonly Pick<Log, 'data' | 'topics'>[],
  expectedContentHash: Hex,
): boolean {
  const expected = expectedContentHash.toLowerCase();
  for (const logItem of logs) {
    try {
      const decoded = decodeEventLog({
        abi: DEVICE_NFT_ABI,
        data: logItem.data,
        topics: logItem.topics,
      });
      if (decoded.eventName !== 'DeviceEvent') {
        continue;
      }
      if (decoded.args.eventType !== DEVICE_EVENT_TYPE_TELEMETRY_HASH) {
        continue;
      }
      if (decoded.args.data.toLowerCase() === expected) {
        return true;
      }
    } catch {
      // Not a DeviceEvent log.
    }
  }
  return false;
}

/**
 * Select mock / DeviceNFT / fail-closed ProvenanceAnchor.
 */
export function createProvenanceAnchorForEnv(): ProvenanceAnchor {
  const env = getServerEnv();
  if (env.ALLOW_MOCK_ADAPTERS) {
    return createMockProvenanceAnchor();
  }
  if (isDeviceNftMintConfigured(env)) {
    return createLiveDeviceNftProvenanceAnchor();
  }
  return createFailClosedProvenanceAnchorDeferred();
}

function createFailClosedProvenanceAnchorDeferred(): ProvenanceAnchor {
  return {
    async anchorTelemetry() {
      throw new Error(
        'On-chain provenance is not configured (set DEVICE_NFT_CONTRACT_ADDRESS + USE_ARC_NETWORK/ARC_RPC_URL/ARC_AUTH_TOKEN + DEVICE_NFT_MINTER_PRIVATE_KEY, or ALLOW_MOCK_ADAPTERS).',
      );
    },
    async getAnchorStatus() {
      return { status: 'pending' };
    },
    async verifyAnchor() {
      return {
        valid: false,
        reason: 'On-chain provenance is not configured.',
      };
    },
  };
}
