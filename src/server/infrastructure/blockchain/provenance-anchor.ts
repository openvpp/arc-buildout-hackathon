import { createHash } from 'node:crypto';

import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ARC_TESTNET_CHAIN_ID } from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import type { ProvenanceAnchor } from '@/server/domain/shared/ports';
import {
  BATCH_ANCHOR_ABI,
  BATCH_ANCHOR_ABI_VERSION,
} from '@/server/infrastructure/blockchain/batch-anchor-abi';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'provenance-anchor' });

function toBytes32ContentHash(contentHash: string): Hex {
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
 * Mock anchor for CI / ALLOW_MOCK_ADAPTERS demos.
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
        transactionHash,
        abiVersion: BATCH_ANCHOR_ABI_VERSION,
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

export function createLiveProvenanceAnchor(input?: {
  publicClient?: PublicClient;
  walletClient?: WalletClient;
}): ProvenanceAnchor {
  const env = getServerEnv();
  const contractAddress = env.BATCH_ANCHOR_CONTRACT_ADDRESS;
  if (contractAddress === undefined || contractAddress.length === 0) {
    throw new Error(
      'BATCH_ANCHOR_CONTRACT_ADDRESS is required for live anchoring',
    );
  }

  const rpcUrl = env.ARC_RPC_URL;
  if (rpcUrl === undefined || rpcUrl.length === 0) {
    throw new Error('ARC_RPC_URL is required for live anchoring');
  }

  if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') {
    if (
      env.BATCH_ANCHOR_SIGNER_PRIVATE_KEY !== undefined &&
      env.BATCH_ANCHOR_SIGNER_PRIVATE_KEY.length > 0
    ) {
      throw new Error(
        'BATCH_ANCHOR_SIGNER_PRIVATE_KEY is forbidden in production/staging',
      );
    }
    throw new Error(
      'Live BatchAnchor signer via env private key is not supported in production/staging. Use KMS via BATCH_ANCHOR_SIGNER_KEY_REFERENCE.',
    );
  }

  const privateKey = env.BATCH_ANCHOR_SIGNER_PRIVATE_KEY;
  if (privateKey === undefined || privateKey.length === 0) {
    throw new Error(
      'BATCH_ANCHOR_SIGNER_PRIVATE_KEY is required for live anchoring in development/demo/test',
    );
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const chainId = Number(env.ARC_CHAIN_ID ?? ARC_TESTNET_CHAIN_ID);
  const chain = {
    id: chainId,
    name: 'arc-testnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;

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
      const hashBytes = toBytes32ContentHash(anchorInput.contentHash);
      const hash = await walletClient.writeContract({
        address: contractAddress as Hex,
        abi: BATCH_ANCHOR_ABI,
        functionName: 'anchorContentHash',
        args: [hashBytes],
        account,
        chain,
      });
      log.info('provenance.submitted', {
        telemetryRecordId: anchorInput.telemetryRecordId,
        transactionHash: hash,
        abiVersion: BATCH_ANCHOR_ABI_VERSION,
      });
      return { status: 'submitted', transactionHash: hash.toLowerCase() };
    },

    async getAnchorStatus(statusInput) {
      // Live status is confirmation-driven via CHECK_ANCHOR_CONFIRMATIONS + DB.
      // This method remains for optional callers; without a known tx it stays pending.
      void statusInput;
      return { status: 'pending' };
    },

    async verifyAnchor(verifyInput) {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: verifyInput.anchorTransactionHash as Hex,
        });
        if (receipt.status !== 'success') {
          return { valid: false, reason: 'Anchor transaction failed on-chain' };
        }
        return { valid: true };
      } catch {
        return { valid: false, reason: 'Anchor transaction receipt not found' };
      }
    },
  };
}

/**
 * Select mock / live / fail-closed ProvenanceAnchor for the current env.
 */
export function createProvenanceAnchorForEnv(): ProvenanceAnchor {
  const env = getServerEnv();
  if (env.ALLOW_MOCK_ADAPTERS) {
    return createMockProvenanceAnchor();
  }
  if (
    env.BATCH_ANCHOR_CONTRACT_ADDRESS !== undefined &&
    env.BATCH_ANCHOR_CONTRACT_ADDRESS.length > 0
  ) {
    return createLiveProvenanceAnchor();
  }
  return createFailClosedProvenanceAnchorDeferred();
}

function createFailClosedProvenanceAnchorDeferred(): ProvenanceAnchor {
  return {
    async anchorTelemetry() {
      throw new Error(
        'BatchAnchor is not configured (set BATCH_ANCHOR_CONTRACT_ADDRESS or ALLOW_MOCK_ADAPTERS).',
      );
    },
    async getAnchorStatus() {
      return { status: 'pending' };
    },
    async verifyAnchor() {
      return {
        valid: false,
        reason: 'BatchAnchor is not configured.',
      };
    },
  };
}
