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
  CONSENT_REQUIRED: 400,
  INVALID_CURSOR: 400,
  DEVICE_PERSIST_FAILED: 500,
};

export function applicationErrorStatus(code: string): number {
  return STATUS_BY_CODE[code] ?? 400;
}
