import { afterEach, describe, expect, it, vi } from 'vitest';

import { getServerEnv } from '@/server/config/env';
import { fetchTokenDeviceEventsFromExplorer } from '@/server/infrastructure/explorer/blockscout-client';

const CONTRACT = '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908';
const env = getServerEnv();
const originalExplorerUrl = env.ARC_EXPLORER_API_URL;

function respondWith(body: unknown) {
  const fetchMock = vi.fn(async (_input: URL | string) => Response.json(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  env.ARC_EXPLORER_API_URL = originalExplorerUrl;
});

describe('fetchTokenDeviceEventsFromExplorer', () => {
  it('treats an empty "No logs found" list as no events', async () => {
    respondWith({ status: '0', message: 'No logs found', result: [] });
    expect(
      await fetchTokenDeviceEventsFromExplorer({
        contractAddress: CONTRACT,
        tokenId: 82n,
      }),
    ).toEqual({ ok: true, logs: [] });
  });

  it('never reports an error response as "0 events"', async () => {
    respondWith({
      status: '0',
      message: 'Invalid fromBlock format',
      result: null,
    });
    expect(
      await fetchTokenDeviceEventsFromExplorer({
        contractAddress: CONTRACT,
        tokenId: 82n,
      }),
    ).toEqual({ ok: false, reason: 'unavailable' });

    respondWith({
      status: '0',
      message: 'NOTOK',
      result: 'Max rate limit reached',
    });
    expect(
      await fetchTokenDeviceEventsFromExplorer({
        contractAddress: CONTRACT,
        tokenId: 82n,
      }),
    ).toEqual({ ok: false, reason: 'blocked' });
  });

  it('keeps an apikey configured in ARC_EXPLORER_API_URL', async () => {
    env.ARC_EXPLORER_API_URL = 'https://explorer.example/api?apikey=test-key';
    const fetchMock = respondWith({ status: '1', message: 'OK', result: [] });
    await fetchTokenDeviceEventsFromExplorer({
      contractAddress: CONTRACT,
      tokenId: 82n,
    });
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.searchParams.get('apikey')).toBe('test-key');
    expect(requested.searchParams.get('action')).toBe('getLogs');
  });
});
