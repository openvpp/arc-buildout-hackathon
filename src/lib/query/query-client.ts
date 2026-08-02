import { QueryClient } from '@tanstack/react-query';

import { normalizeError } from '@/lib/api/errors';

/**
 * TanStack Query client with production-safe defaults.
 *
 * Retry policy:
 *  - NEVER retry deterministic client failures: 400, 401, 402, 403, 404, 422,
 *    validation errors, or aborts. `402 Payment Required` is an expected domain
 *    response and must never be retried.
 *  - Retry only transient failures (network, timeout, 408, 429, 5xx), bounded.
 *  - Mutations never retry (payments and other writes are non-idempotent).
 *
 * Refetching is conservative and polling is DISABLED by default (see
 * `lib/query/polling.ts` for the intended telemetry-polling extension point).
 */

const MAX_QUERY_RETRIES = 2;

const NON_RETRYABLE_STATUS = new Set([400, 401, 402, 403, 404, 422]);
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  const apiError = normalizeError(error);

  switch (apiError.kind) {
    case 'validation':
    case 'aborted':
    case 'parse':
      return false;
    case 'http': {
      const status = apiError.status;
      if (status !== undefined && NON_RETRYABLE_STATUS.has(status))
        return false;
      if (status !== undefined && !RETRYABLE_STATUS.has(status)) return false;
      return failureCount < MAX_QUERY_RETRIES;
    }
    case 'network':
    case 'timeout':
      return failureCount < MAX_QUERY_RETRIES;
    case 'unknown':
      return false;
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Explicit, conservative freshness. Tune per-query as real data lands.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: shouldRetryQuery,
        retryDelay: (attempt) => Math.min(1_000 * 2 ** attempt, 10_000),
        // No aggressive refetching without a business reason.
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Polling is opt-in only. Never poll globally by default.
        refetchInterval: false,
      },
      mutations: {
        // Writes (payments, etc.) are non-idempotent: never retry automatically.
        retry: false,
      },
    },
  });
}
