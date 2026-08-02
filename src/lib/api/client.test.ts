import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ApiClient } from '@/lib/api/client';
import type { ApiResult } from '@/lib/api/types';

const schema = z.object({ value: z.string() });

function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

function makeClient(): ApiClient {
  return new ApiClient({ baseUrl: 'http://api.test' });
}

/** Narrowing guard so assertions stay out of conditionals. */
function expectOk<T>(
  result: ApiResult<T>,
): Extract<ApiResult<T>, { ok: true }> {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error.kind}`);
  }
  return result;
}

function expectErr<T>(
  result: ApiResult<T>,
): Extract<ApiResult<T>, { ok: false }> {
  if (result.ok) throw new Error('expected error result, got ok');
  return result;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ApiClient.request', () => {
  it('returns validated data and the response request id on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { value: 'ok' },
            { headers: { 'x-request-id': 'srv-1' } },
          ),
        ),
    );

    const ok = expectOk(await makeClient().request('/thing', { schema }));
    expect(ok.data.value).toBe('ok');
    expect(ok.requestId).toBe('srv-1');
  });

  it('returns a validation error when the body fails the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ value: 123 })),
    );

    const err = expectErr(await makeClient().request('/thing', { schema }));
    expect(err.error.kind).toBe('validation');
  });

  it('returns an http error with the status for non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, { status: 500 })),
    );

    const err = expectErr(await makeClient().request('/thing', { schema }));
    expect(err.error.kind).toBe('http');
    expect(err.error.status).toBe(500);
  });

  it('returns a parse error for non-JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('not-json', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      ),
    );

    const err = expectErr(await makeClient().request('/thing', { schema }));
    expect(err.error.kind).toBe('parse');
  });

  it('sends an X-Request-Id header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ value: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await makeClient().request('/thing', { schema });

    const [, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers['X-Request-Id']).toBeTruthy();
  });
});
