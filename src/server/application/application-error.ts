/**
 * A failure the application layer intends a route to show to the caller.
 * `message` must already be safe to return; never put upstream bodies,
 * SQL, or secrets in it. HTTP status is mapped in the route handler.
 */
export class ApplicationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  PRINCIPAL_DISABLED: 403,
  WALLET_DISABLED: 403,
  PENDING_CONNECTION_NOT_FOUND: 404,
  USER_ID_MISMATCH: 403,
  PENDING_EXPIRED: 409,
  PENDING_INVALID_STATUS: 409,
  PENDING_CONNECTION_COMPLETED: 409,
  PENDING_OAUTH_INCOMPLETE: 409,
  GOOGLE_SIGN_IN_FAILED: 401,
  GOOGLE_SIGN_IN_UNAVAILABLE: 503,
  EMAIL_INVALID: 400,
  PASSWORD_INVALID: 400,
  ACCOUNT_EXISTS: 409,
  INVALID_LOGIN: 401,
  WALLET_OPEN_FAILED: 503,
  CONSENT_REQUIRED: 400,
  INVALID_CURSOR: 400,
  DEVICE_PERSIST_FAILED: 500,
  ADDRESS_REQUIRED: 400,
  ADDRESS_NOT_FOUND: 422,
  ADDRESS_NOT_PRECISE: 422,
  ADDRESS_LOOKUP_UNAVAILABLE: 503,
  VENDOR_NOT_SUPPORTED: 400,
};

export function applicationErrorStatus(code: string): number {
  return STATUS_BY_CODE[code] ?? 400;
}
