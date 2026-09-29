import { ApiError } from '@/server/transport/http/api-error';

type Bucket = number[];

const buckets = new Map<string, Bucket>();

export type RateLimitResult =
  { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Fixed-window counter kept in process memory. Enough to brake credential
 * stuffing and wallet-creation bursts on a single Node server. It does not
 * coordinate across multiple instances — put a shared limiter in front of
 * the app if you run more than one.
 */
export function consumeRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): RateLimitResult {
  const now = input.now ?? Date.now();
  const windowStart = now - input.windowMs;
  const recent = (buckets.get(input.key) ?? []).filter(
    (timestamp) => timestamp > windowStart,
  );
  if (recent.length >= input.limit) {
    const oldest = recent[0] ?? now;
    buckets.set(input.key, recent);
    return {
      ok: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + input.windowMs - now) / 1000),
      ),
    };
  }
  recent.push(now);
  buckets.set(input.key, recent);
  if (buckets.size > 5_000) {
    for (const [key, stamps] of buckets) {
      if (stamps.every((timestamp) => timestamp <= windowStart)) {
        buckets.delete(key);
      }
    }
  }
  return { ok: true };
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const firstHop = forwarded?.split(',')[0]?.trim();
  if (firstHop !== undefined && firstHop.length > 0) {
    return firstHop.slice(0, 64);
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) {
    return realIp.slice(0, 64);
  }
  return 'unknown';
}

export function enforceRateLimit(input: {
  request: Request;
  bucket: string;
  limit: number;
  windowMs: number;
  /** `global` counts every caller together (use for a normalized email). */
  scope?: 'ip' | 'global';
  keySuffix?: string;
}): void {
  const identity =
    input.scope === 'global'
      ? (input.keySuffix ?? 'all')
      : `${clientAddress(input.request)}${
          input.keySuffix !== undefined ? `:${input.keySuffix}` : ''
        }`;
  const key = `${input.bucket}:${identity}`;
  const result = consumeRateLimit({
    key,
    limit: input.limit,
    windowMs: input.windowMs,
  });
  if (!result.ok) {
    throw new ApiError({
      code: 'RATE_LIMITED',
      message: 'Too many requests. Try again shortly.',
      status: 429,
      headers: { 'retry-after': String(result.retryAfterSeconds) },
    });
  }
}
