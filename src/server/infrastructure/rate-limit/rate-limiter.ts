import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { rateLimitBuckets } from '@/server/infrastructure/db/schema';

/**
 * Database-backed rate limiter suitable for multi-instance deployments.
 * In-memory limiters are intentionally not provided for production use.
 */
export type RateLimitResult =
  | { allowed: true; remaining: number; resetAt: Date }
  | { allowed: false; remaining: 0; resetAt: Date; retryAfterSeconds: number };

export async function consumeRateLimit(
  db: Database,
  input: {
    bucketKey: string;
    limit: number;
    windowSeconds: number;
  },
): Promise<RateLimitResult> {
  const now = new Date();
  const windowStartMs =
    Math.floor(now.getTime() / (input.windowSeconds * 1000)) *
    input.windowSeconds *
    1000;
  const windowStartedAt = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + input.windowSeconds * 1000);

  await db
    .insert(rateLimitBuckets)
    .values({
      bucketKey: input.bucketKey,
      windowStartedAt,
      windowSeconds: input.windowSeconds,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.bucketKey, rateLimitBuckets.windowStartedAt],
      set: {
        count: sql`${rateLimitBuckets.count} + 1`,
        updatedAt: now,
      },
    });

  const [row] = await db
    .select({ count: rateLimitBuckets.count })
    .from(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.bucketKey, input.bucketKey),
        eq(rateLimitBuckets.windowStartedAt, windowStartedAt),
      ),
    )
    .limit(1);

  const count = row?.count ?? 1;
  if (count > input.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((resetAt.getTime() - now.getTime()) / 1000),
      ),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, input.limit - count),
    resetAt,
  };
}
