import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, requestId: string): NextResponse {
  return NextResponse.json({ ok: true, data, requestId });
}

export function jsonError(
  input: { code: string; message: string; details?: Record<string, unknown> },
  status: number,
  requestId: string,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        details: input.details,
      },
      requestId,
    },
    { status },
  );
}
