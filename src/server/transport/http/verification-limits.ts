import { enforceRateLimit } from '@/server/transport/http/rate-limit';

/**
 * Public verification is unauthenticated, so reads are rate-limited per IP,
 * and a forced chain read (`refresh=1`) has its own tighter budget because
 * it costs RPC calls. Plain reads only touch the database (see
 * getPublicEventVerification).
 */
export function enforcePublicVerificationLimits(
  request: Request,
  refresh: boolean,
): void {
  enforceRateLimit({
    request,
    bucket: 'verify-read',
    limit: 120,
    windowMs: 60 * 1000,
  });
  if (refresh) {
    enforceRateLimit({
      request,
      bucket: 'verify-refresh',
      limit: 10,
      windowMs: 60 * 1000,
    });
  }
}

export function wantsRefresh(request: Request): boolean {
  const value = new URL(request.url).searchParams.get('refresh');
  return value === '1' || value === 'true';
}

/** Same limits for Server Components, which only have request headers. */
export function enforcePublicVerificationLimitsForHeaders(
  headers: Headers,
  refresh: boolean,
): void {
  enforcePublicVerificationLimits(
    new Request('http://local/verify', { headers }),
    refresh,
  );
}
