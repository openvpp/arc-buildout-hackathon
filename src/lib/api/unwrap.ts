import type { ApiError } from '@/lib/api/errors';
import type { ApiResult } from '@/lib/api/types';

/**
 * Bridge between the client's non-throwing `ApiResult` and TanStack Query,
 * which drives its retry/error state from thrown values. Use inside query
 * functions: `return unwrapApiResult(await apiClient.request(...))`.
 *
 * Throws the normalized `ApiError` on failure so the query layer's retry policy
 * (see `createQueryClient`) can inspect it.
 */
export function unwrapApiResult<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw result.error satisfies ApiError;
}
