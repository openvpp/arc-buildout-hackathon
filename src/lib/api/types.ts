import type { ApiError } from '@/lib/api/errors';

/**
 * Transport-level API contracts.
 *
 * `ApiResult` is a discriminated union so callers must handle failure
 * explicitly — there is no way to read `.data` without first narrowing on
 * `ok`. Keep transport shapes here separate from UI view models.
 */

export type ApiResult<T> =
  | { readonly ok: true; readonly data: T; readonly requestId: string | null }
  | { readonly ok: false; readonly error: ApiError };

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A runtime validator for a response body. Kept structural (not tied to Zod) so
 * the client depends only on a `parse`/`safeParse`-shaped contract. Zod schemas
 * satisfy this directly.
 */
export type ResponseValidator<T> = {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: unknown };
};

export type RequestOptions<T> = {
  readonly method?: HttpMethod;
  /** JSON-serializable request body. */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly searchParams?: Readonly<Record<string, string | number | boolean>>;
  /** Per-request timeout in ms. Overrides the client default. */
  readonly timeoutMs?: number;
  /** Caller-supplied abort signal, composed with the timeout signal. */
  readonly signal?: AbortSignal;
  /** Runtime validator applied to the parsed JSON body on 2xx responses. */
  readonly schema?: ResponseValidator<T>;
  /**
   * Idempotency marker. Non-idempotent requests (e.g. payments) must never be
   * retried automatically; the client refuses to retry unless this is `true`.
   */
  readonly idempotent?: boolean;
};
