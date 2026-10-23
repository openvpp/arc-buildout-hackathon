import type { PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';

import { getServerEnv } from '@/server/config/env';
import { createDeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';

/** A client whose getBlock fails with `error` `failures` times, then works. */
function flakyClient(error: Error, failures: number) {
  const calls = { getBlock: 0 };
  const client = {
    getChainId: async () => Number(getServerEnv().ARC_CHAIN_ID),
    getBlock: async () => {
      calls.getBlock += 1;
      if (calls.getBlock <= failures) {
        throw error;
      }
      return { number: 10n, timestamp: 1n, transactions: [] };
    },
  };
  // Only getChainId/getBlock are exercised; the reader never touches other members here.
  return { client: client as unknown as PublicClient, calls };
}

describe('device event chain reader retries', () => {
  it('retries a history miss from a load-balanced node', async () => {
    const { client, calls } = flakyClient(
      new Error('requested data not available'),
      2,
    );
    const block = await createDeviceEventChainReader(client).readBlock(10n);
    expect(block?.number).toBe(10n);
    expect(calls.getBlock).toBe(3);
  });

  it('fails fast on rate limits and timeouts (no stacked retries)', async () => {
    const { client, calls } = flakyClient(
      new Error('HTTP request failed. Status: 429'),
      5,
    );
    await expect(
      createDeviceEventChainReader(client).readBlock(10n),
    ).rejects.toThrow('429');
    expect(calls.getBlock).toBe(1);
  });

  it('refuses to read an RPC that serves another chain', async () => {
    const { client, calls } = flakyClient(new Error('unused'), 0);
    const wrongChain = { ...client, getChainId: async () => 1 };
    await expect(
      createDeviceEventChainReader(
        wrongChain as unknown as PublicClient,
      ).readBlock(10n),
    ).rejects.toThrow(/serves chain 1/);
    expect(calls.getBlock).toBe(0);
  });
});
