/**
 * Stable machine-readable API error codes.
 * Do not expose stack traces, SQL, or secrets in messages.
 */
export const API_ERROR_CODES = [
  'AUTHENTICATION_REQUIRED',
  'ACCESS_DENIED',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'NO_NEW_RECORD',
  'NO_TELEMETRY_AVAILABLE',
  'PAYMENT_REQUIRED',
  'PAYMENT_REQUIREMENT_EXPIRED',
  'PAYMENT_TRANSACTION_INVALID',
  'PAYMENT_TRANSACTION_REUSED',
  'PAYMENT_TRANSACTION_NOT_CONFIRMED',
  'PAYMENT_VERIFICATION_UNAVAILABLE',
  'PROVENANCE_PENDING',
  'PROVENANCE_VERIFICATION_FAILED',
  'ENODE_WEBHOOK_INVALID',
  'IDEMPOTENCY_KEY_CONFLICT',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly details?: Record<string, unknown>;
  };
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly expose: boolean;

  constructor(input: {
    code: ApiErrorCode;
    message: string;
    status: number;
    details?: Record<string, unknown>;
    expose?: boolean;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.expose = input.expose ?? true;
  }
}

export function toApiErrorBody(
  error: ApiError,
  requestId: string,
): ApiErrorBody {
  return {
    error: {
      code: error.code,
      message: error.expose ? error.message : 'An unexpected error occurred.',
      requestId,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };
}

export function mapUnknownErrorToApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    status: 500,
    expose: false,
  });
}
