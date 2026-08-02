import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER } from '@/server/config/constants';

export type RequestContext = {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  readonly userAgent: string | undefined;
  readonly ipHash: string | undefined;
};

function truncateHash(value: string): string {
  // Lightweight, non-cryptographic fingerprint for audit correlation only.
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function createRequestContext(request: Request): RequestContext {
  const headerId = request.headers.get(REQUEST_ID_HEADER);
  const requestId =
    headerId !== null && headerId.trim().length > 0
      ? headerId.trim()
      : randomUUID();

  const url = new URL(request.url);
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ip =
    forwardedFor?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    undefined;

  return {
    requestId,
    method: request.method,
    path: url.pathname,
    startedAt: Date.now(),
    userAgent: request.headers.get('user-agent') ?? undefined,
    ipHash: ip !== undefined ? truncateHash(ip) : undefined,
  };
}
