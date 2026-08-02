import { env } from '@/config/env';
import { ApiError, normalizeError } from '@/lib/api/errors';
import type { ApiResult, RequestOptions } from '@/lib/api/types';

/**
 * Typed API client foundation.
 *
 * Phase 1: fully wired but NOT connected to a real backend — no production call
 * site exists yet. It exists so the eventual backend integration has a single,
 * validated, well-behaved boundary to build on.
 *
 * Guarantees:
 *  - Exactly ONE network attempt per call. The client never retries. Any retry
 *    policy lives in the TanStack Query layer, which is configured to never
 *    retry non-idempotent or deterministic-failure requests (e.g. payments).
 *  - Every failure is returned as a normalized `ApiError` inside a discriminated
 *    `ApiResult` — callers cannot read data without narrowing on `ok`.
 *  - Response bodies are validated at runtime with the caller's schema.
 *  - Non-JSON and malformed bodies are handled safely, never thrown raw.
 */

const DEFAULT_TIMEOUT_MS = 15_000;

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function buildUrl(
  baseUrl: string,
  path: string,
  searchParams?: RequestOptions<unknown>['searchParams'],
): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  // AbortSignal.any is available in Node 20+ and modern browsers.
  return AbortSignal.any(signals);
}

export type ApiClientConfig = {
  readonly baseUrl: string;
  readonly defaultTimeoutMs: number;
  readonly defaultHeaders: Readonly<Record<string, string>>;
};

export class ApiClient {
  private readonly config: ApiClientConfig;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl ?? env.NEXT_PUBLIC_API_BASE_URL,
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      defaultHeaders: config.defaultHeaders ?? {},
    };
  }

  async request<T>(
    path: string,
    options: RequestOptions<T> = {},
  ): Promise<ApiResult<T>> {
    const requestId = generateRequestId();
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs;

    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = options.signal
      ? combineSignals([timeoutSignal, options.signal])
      : timeoutSignal;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Request-Id': requestId,
      ...this.config.defaultHeaders,
      ...(options.headers ?? {}),
    };

    const hasBody = options.body !== undefined;
    if (hasBody) headers['Content-Type'] = 'application/json';

    const url = buildUrl(this.config.baseUrl, path, options.searchParams);

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        signal,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (caught: unknown) {
      // Distinguish a timeout abort from a caller abort / network failure.
      if (timeoutSignal.aborted) {
        return {
          ok: false,
          error: new ApiError({
            kind: 'timeout',
            message: `Request timed out after ${timeoutMs}ms.`,
            requestId,
            cause: caught,
          }),
        };
      }
      return { ok: false, error: normalizeError(caught) };
    }

    const responseRequestId = response.headers.get('x-request-id') ?? requestId;

    if (!response.ok) {
      return {
        ok: false,
        error: new ApiError({
          kind: 'http',
          message: `Request failed with status ${response.status}.`,
          status: response.status,
          requestId: responseRequestId,
        }),
      };
    }

    // 204 No Content and other empty bodies: nothing to validate.
    const rawBody = await response.text();
    if (rawBody.length === 0) {
      if (options.schema) {
        return {
          ok: false,
          error: new ApiError({
            kind: 'parse',
            message: 'Expected a JSON body but the response was empty.',
            status: response.status,
            requestId: responseRequestId,
          }),
        };
      }
      return { ok: true, data: undefined as T, requestId: responseRequestId };
    }

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch (caught: unknown) {
      return {
        ok: false,
        error: new ApiError({
          kind: 'parse',
          message: 'Response body was not valid JSON.',
          status: response.status,
          requestId: responseRequestId,
          cause: caught,
        }),
      };
    }

    if (!options.schema) {
      // No schema: caller opted out of validation and owns the resulting type.
      return { ok: true, data: json as T, requestId: responseRequestId };
    }

    const parsed = options.schema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: new ApiError({
          kind: 'validation',
          message: 'Response body failed schema validation.',
          status: response.status,
          requestId: responseRequestId,
          cause: parsed.error,
        }),
      };
    }

    return { ok: true, data: parsed.data, requestId: responseRequestId };
  }
}

/** Default client instance, pointed at the configured backend base URL. */
export const apiClient = new ApiClient();
