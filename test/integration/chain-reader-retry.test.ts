import type { PublicClient } from 'viem';
import { describe, expect, it } from 'vitest';

import { createDeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';

/** A client whose getBlock fails with `error` `failures` times, then works. */
function flakyClient(error: Error, failures: number) {
  const calls = { getBlock: 0 };
  const client = {
    getBlock: async () => {
      calls.getBlock += 1;
      if (calls.getBlock <= failures) {
        throw error;
      }
      return { number: 10n, timestamp: 1n, transactions: [] };
    },
  };
  // Only getBlock is exercised; the reader never touches other members here.
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
});
