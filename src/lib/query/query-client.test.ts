import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { createQueryClient, shouldRetryQuery } from '@/lib/query/query-client';

function httpError(status: number): ApiError {
  return new ApiError({ kind: 'http', message: 'x', status });
}

describe('shouldRetryQuery', () => {
  it('never retries deterministic client statuses (incl. 402)', () => {
    for (const status of [400, 401, 402, 403, 404, 422]) {
      expect(shouldRetryQuery(0, httpError(status))).toBe(false);
    }
  });

  it('never retries validation, parse, abort, or unknown errors', () => {
    expect(
      shouldRetryQuery(0, new ApiError({ kind: 'validation', message: 'x' })),
    ).toBe(false);
    expect(
      shouldRetryQuery(0, new ApiError({ kind: 'parse', message: 'x' })),
    ).toBe(false);
    expect(
      shouldRetryQuery(0, new ApiError({ kind: 'aborted', message: 'x' })),
    ).toBe(false);
    expect(
      shouldRetryQuery(0, new ApiError({ kind: 'unknown', message: 'x' })),
    ).toBe(false);
  });

  it('does not retry unexpected http statuses that are neither client nor retryable', () => {
    expect(
      shouldRetryQuery(
        0,
        new ApiError({ kind: 'http', message: 'x', status: 418 }),
      ),
    ).toBe(false);
  });

  it('retries transient server errors up to the limit', () => {
    expect(shouldRetryQuery(0, httpError(503))).toBe(true);
    expect(shouldRetryQuery(1, httpError(503))).toBe(true);
    expect(shouldRetryQuery(2, httpError(503))).toBe(false);
  });

  it('retries network and timeout errors, bounded', () => {
    expect(
      shouldRetryQuery(0, new ApiError({ kind: 'network', message: 'x' })),
    ).toBe(true);
    expect(
      shouldRetryQuery(2, new ApiError({ kind: 'timeout', message: 'x' })),
    ).toBe(false);
  });
});

describe('createQueryClient', () => {
  it('applies conservative, production-safe defaults', () => {
    const options = createQueryClient().getDefaultOptions();

    expect(options.queries?.staleTime).toBe(30_000);
    expect(options.queries?.refetchOnWindowFocus).toBe(false);
    expect(options.queries?.refetchInterval).toBe(false);
    expect(options.mutations?.retry).toBe(false);
  });

  it('uses a bounded exponential backoff for retry delay', () => {
    const retryDelay =
      createQueryClient().getDefaultOptions().queries?.retryDelay;

    const first =
      typeof retryDelay === 'function' ? retryDelay(0, new Error('x')) : -1;
    const capped =
      typeof retryDelay === 'function' ? retryDelay(50, new Error('x')) : -1;

    expect(first).toBeGreaterThan(0);
    expect(capped).toBeLessThanOrEqual(10_000);
  });
});
