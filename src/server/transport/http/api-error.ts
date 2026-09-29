export type ApiErrorInput = {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  headers?: Record<string, string>;
};

/** A typed, client-safe error. Route handlers throw this; never a raw Error. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(input: ApiErrorInput) {
    super(input.message);
    this.name = 'ApiError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
    this.headers = input.headers;
  }
}
