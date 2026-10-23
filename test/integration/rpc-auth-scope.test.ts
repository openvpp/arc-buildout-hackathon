import { createPublicClient } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerEnv } from '@/server/config/env';
import {
  createArcHttpTransport,
  createVerifierHttpTransport,
} from '@/server/infrastructure/blockchain/network-provider';

const env = getServerEnv();
const saved = {
  ARC_RPC_URL: env.ARC_RPC_URL,
  ARC_AUTH_TOKEN: env.ARC_AUTH_TOKEN,
  VERIFIER_RPC_URL: env.VERIFIER_RPC_URL,
  VERIFIER_AUTH_TOKEN: env.VERIFIER_AUTH_TOKEN,
};

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(env, saved);
});

/** URL and Authorization header of the one JSON-RPC request made. */
async function firstRequest(
  transport: ReturnType<typeof createArcHttpTransport>,
) {
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ jsonrpc: '2.0', id: 0, result: '0x1' }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await createPublicClient({ transport }).getBlockNumber();
  const [input, init] = fetchMock.mock.calls[0] ?? [];
  return {
    url: String(input instanceof Request ? input.url : input),
    authorization: new Headers(init?.headers).get('authorization'),
  };
}

describe('RPC auth tokens', () => {
  it('sends ARC_AUTH_TOKEN only to an explicit ARC_RPC_URL', async () => {
    env.ARC_AUTH_TOKEN = 'provider-token';
    env.ARC_RPC_URL = 'https://rpc.provider.example';
    expect(await firstRequest(createArcHttpTransport(env))).toEqual({
      url: 'https://rpc.provider.example/',
      authorization: 'Bearer provider-token',
    });

    env.ARC_RPC_URL = undefined;
    const fallback = await firstRequest(createArcHttpTransport(env));
    expect(fallback.url).toMatch(/^https:\/\/rpc\.(testnet|mainnet)\.arc\.io/);
    expect(fallback.authorization).toBeNull();
  });

  it('gives the verifier RPC its own token', async () => {
    env.ARC_AUTH_TOKEN = 'provider-token';
    env.VERIFIER_RPC_URL = 'https://verifier.example';
    env.VERIFIER_AUTH_TOKEN = 'verifier-token';
    expect(await firstRequest(createVerifierHttpTransport(env))).toEqual({
      url: 'https://verifier.example/',
      authorization: 'Bearer verifier-token',
    });
  });
});
