/**
 * Normalized API error handling.
 *
 * Every failure from the API client is normalized into a single `ApiError`
 * shape with a discriminated `kind`, so callers branch on a stable contract
 * instead of guessing at heterogeneous thrown values. Internal details are kept
 * out of user-facing strings (see `error-state` component).
 */

export type ApiErrorKind =
  | 'network' // could not reach the server
  | 'timeout' // request exceeded the configured timeout
  | 'aborted' // caller aborted via AbortSignal
  | 'http' // non-2xx response (see `status`)
  | 'parse' // response body was not valid JSON when JSON was expected
  | 'validation' // response JSON failed schema validation
  | 'unknown'; // anything else

export type ApiErrorInit = {
  readonly kind: ApiErrorKind;
  readonly message: string;
  readonly status?: number;
  readonly requestId?: string;
  readonly cause?: unknown;
};

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly requestId?: string;

  constructor(init: ApiErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : {});
    this.name = 'ApiError';
    this.kind = init.kind;
    if (init.status !== undefined) this.status = init.status;
    if (init.requestId !== undefined) this.requestId = init.requestId;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * `402 Payment Required` is an EXPECTED domain response in this platform, not a
 * generic error. Callers use this to branch into the payment flow rather than
 * surfacing a failure.
 */
export function isPaymentRequired(error: unknown): boolean {
  return isApiError(error) && error.status === 402;
}

/** Normalize any thrown/unknown value into a stable `ApiError`. */
export function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) return error;

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ApiError({
      kind: 'aborted',
      message: 'The request was aborted.',
      cause: error,
    });
  }

  if (error instanceof TypeError) {
    // fetch throws TypeError for network-level failures.
    return new ApiError({
      kind: 'network',
      message: 'Unable to reach the server.',
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new ApiError({
      kind: 'unknown',
      message: error.message,
      cause: error,
    });
  }

  return new ApiError({
    kind: 'unknown',
    message: 'An unknown error occurred.',
    cause: error,
  });
}
