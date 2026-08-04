import { eq } from 'drizzle-orm';
import type { Hex, PublicClient } from 'viem';
import { createPublicClient, http } from 'viem';

import { ARC_TESTNET_CHAIN_ID } from '@/server/config/circle';
import { getServerEnv } from '@/server/config/env';
import type { ProvenanceAnchor } from '@/server/domain/shared/ports';
import type { Database } from '@/server/infrastructure/db/client';
import { telemetryRecords } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'check-anchor-confirmations' });

function createDefaultPublicClient(): PublicClient | null {
  const env = getServerEnv();
  if (env.ARC_RPC_URL === undefined || env.ARC_RPC_URL.length === 0) {
    return null;
  }
  const chainId = Number(env.ARC_CHAIN_ID ?? ARC_TESTNET_CHAIN_ID);
  return createPublicClient({
    chain: {
      id: chainId,
      name: 'arc-testnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [env.ARC_RPC_URL] } },
    },
    transport: http(env.ARC_RPC_URL),
  });
}

/**
 * Confirm a submitted anchor transaction and mark the telemetry record anchored.
 */
export async function checkTelemetryAnchorConfirmations(input: {
  db: Database;
  provenanceAnchor: ProvenanceAnchor;
  telemetryRecordId: string;
  transactionHash?: string;
  publicClient?: PublicClient | null;
}): Promise<void> {
  const env = getServerEnv();
  const [record] = await input.db
    .select()
    .from(telemetryRecords)
    .where(eq(telemetryRecords.id, input.telemetryRecordId))
    .limit(1);

  if (record === undefined) {
    log.warn('provenance.record_missing', {
      telemetryRecordId: input.telemetryRecordId,
    });
    return;
  }

  if (record.anchorStatus === 'anchored') {
    return;
  }

  const transactionHash =
    input.transactionHash ?? record.anchorTransactionHash ?? undefined;
  if (transactionHash === undefined || transactionHash.length === 0) {
    throw new Error('CHECK_ANCHOR_CONFIRMATIONS missing transactionHash');
  }

  if (env.ALLOW_MOCK_ADAPTERS) {
    const verified = await input.provenanceAnchor.verifyAnchor({
      contentHash: record.contentHash,
      anchorTransactionHash: transactionHash,
    });
    if (!verified.valid) {
      await input.db
        .update(telemetryRecords)
        .set({ anchorStatus: 'failed' })
        .where(eq(telemetryRecords.id, record.id));
      throw new Error(verified.reason ?? 'Mock anchor verification failed');
    }

    await input.db
      .update(telemetryRecords)
      .set({
        anchorStatus: 'anchored',
        anchorTransactionHash: transactionHash,
        anchoredAt: new Date(),
        anchorBlockNumber: 1n,
        anchorBlockHash: `0x${'ab'.repeat(32)}`,
      })
      .where(eq(telemetryRecords.id, record.id));
    return;
  }

  const publicClient = input.publicClient ?? createDefaultPublicClient();
  if (publicClient === null) {
    throw new Error('ARC_RPC_URL is required to confirm anchors');
  }

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({
      hash: transactionHash as Hex,
    });
  } catch {
    throw new Error(`Anchor receipt not found yet: ${transactionHash}`);
  }

  if (receipt.status !== 'success') {
    await input.db
      .update(telemetryRecords)
      .set({
        anchorStatus: 'failed',
        anchorTransactionHash: transactionHash,
      })
      .where(eq(telemetryRecords.id, record.id));
    return;
  }

  const head = await publicClient.getBlockNumber();
  const confirmations = head - receipt.blockNumber + 1n;
  const required = BigInt(env.ARC_REQUIRED_CONFIRMATIONS);
  if (confirmations < required) {
    throw new Error(
      `Anchor waiting for confirmations: ${confirmations}/${required}`,
    );
  }

  const verified = await input.provenanceAnchor.verifyAnchor({
    contentHash: record.contentHash,
    anchorTransactionHash: transactionHash,
  });
  if (!verified.valid) {
    await input.db
      .update(telemetryRecords)
      .set({ anchorStatus: 'failed' })
      .where(eq(telemetryRecords.id, record.id));
    throw new Error(verified.reason ?? 'Anchor verification failed');
  }

  await input.db
    .update(telemetryRecords)
    .set({
      anchorStatus: 'anchored',
      anchorTransactionHash: transactionHash,
      anchorBlockNumber: receipt.blockNumber,
      anchorBlockHash: receipt.blockHash,
      anchoredAt: new Date(),
    })
    .where(eq(telemetryRecords.id, record.id));

  log.info('provenance.anchored', {
    telemetryRecordId: record.id,
    transactionHash,
    confirmations: confirmations.toString(),
  });
}
