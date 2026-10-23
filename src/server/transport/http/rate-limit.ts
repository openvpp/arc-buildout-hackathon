import { getServerEnv } from '@/server/config/env';
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

/** True when `key` has used up its window, without counting this call. */
export function isRateLimited(input: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();
  const recent = (buckets.get(input.key) ?? []).filter(
    (timestamp) => timestamp > now - input.windowMs,
  );
  return recent.length >= input.limit;
}

/** Counts one hit against `key` (e.g. a failed sign-in). */
export function recordRateLimitHit(input: {
  key: string;
  windowMs: number;
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const recent = (buckets.get(input.key) ?? []).filter(
    (timestamp) => timestamp > now - input.windowMs,
  );
  recent.push(now);
  buckets.set(input.key, recent);
}

/**
 * The client IP as seen by the nearest trusted proxy: X-Forwarded-For
 * entries are appended left to right, so only the entry `trustedHops` from
 * the right was written by infrastructure we control; anything further left
 * is whatever the client sent. With no trusted proxy there is no reliable
 * client IP and callers share one bucket.
 */
export function clientAddressFromForwardedFor(
  forwarded: string | null,
  trustedHops: number,
): string {
  if (trustedHops === 0 || forwarded === null) {
    return 'unknown';
  }
  const hops = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const entry = hops[hops.length - trustedHops];
  return entry === undefined ? 'unknown' : entry.slice(0, 64);
}

export function clientAddress(request: Request): string {
  return clientAddressFromForwardedFor(
    request.headers.get('x-forwarded-for'),
    getServerEnv().TRUSTED_PROXY_HOPS,
  );
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
