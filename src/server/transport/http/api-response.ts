import { NextResponse } from 'next/server';

export function jsonOk<T>(data: T, requestId: string): NextResponse {
  const response = NextResponse.json({ ok: true, data, requestId });
  response.headers.set('x-request-id', requestId);
  return response;
}

export function jsonError(
  input: { code: string; message: string; details?: Record<string, unknown> },
  status: number,
  requestId: string,
): NextResponse {
  const response = NextResponse.json(
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
  response.headers.set('x-request-id', requestId);
  return response;
}
