import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness only. Database readiness is GET /api/health/ready. */
export function GET() {
  return NextResponse.json({ ok: true });
}
