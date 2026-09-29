import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/server/infrastructure/db/client';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createServerLogger({ component: 'health-ready' });

/**
 * Readiness: the process can serve traffic that depends on Postgres.
 * Liveness stays on GET /api/health, which does not touch the database.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error('health.ready_failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
