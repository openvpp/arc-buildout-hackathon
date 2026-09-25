import type { z } from 'zod';

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = 'ApiRequestError';
    this.code = input.code;
    this.status = input.status;
  }
}

const envelopeShape = (data: unknown): data is { ok: boolean } =>
  typeof data === 'object' && data !== null && 'ok' in data;

/** Thin typed fetch wrapper matching the {ok, data|error, requestId} envelope. */
export class ApiClient {
  async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
      body?: unknown;
      headers?: Record<string, string>;
      searchParams?: Record<string, string>;
      schema: z.ZodType<T>;
    },
  ): Promise<{ ok: true; data: T } | { ok: false; error: ApiRequestError }> {
    const url = new URL(path, window.location.origin);
    for (const [key, value] of Object.entries(options.searchParams ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        ...(options.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...options.headers,
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const json: unknown = await response.json().catch(() => null);
    if (!envelopeShape(json)) {
      return {
        ok: false,
        error: new ApiRequestError({
          code: 'INVALID_RESPONSE',
          message: 'Server returned an unexpected response.',
          status: response.status,
        }),
      };
    }

    if (json.ok === false) {
      const errorBody = (
        json as { error?: { code?: string; message?: string } }
      ).error;
      return {
        ok: false,
        error: new ApiRequestError({
          code: errorBody?.code ?? 'UNKNOWN_ERROR',
          message: errorBody?.message ?? 'Request failed.',
          status: response.status,
        }),
      };
    }

    const parsed = options.schema.safeParse((json as { data?: unknown }).data);
    if (!parsed.success) {
      return {
        ok: false,
        error: new ApiRequestError({
          code: 'INVALID_RESPONSE_SHAPE',
          message: 'Server response failed validation.',
          status: response.status,
        }),
      };
    }
    return { ok: true, data: parsed.data };
  }
}
