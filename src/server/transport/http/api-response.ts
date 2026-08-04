import { NextResponse } from 'next/server';

import {
  PAYMENT_PROTOCOL_HEADER,
  REQUEST_ID_HEADER,
} from '@/server/config/constants';

import type { ApiError } from './api-error';
import { toApiErrorBody } from './api-error';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
} as const;

export function jsonOk<T>(
  body: T,
  requestId: string,
  init?: { status?: number; headers?: Record<string, string> },
): NextResponse {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      ...NO_STORE_HEADERS,
      [REQUEST_ID_HEADER]: requestId,
      ...(init?.headers ?? {}),
    },
  });
}

export function jsonError(error: ApiError, requestId: string): NextResponse {
  const retryAfter =
    error.status === 429
      ? (() => {
          const fromDetails = error.details?.['retryAfterSeconds'];
          return typeof fromDetails === 'number' &&
            Number.isFinite(fromDetails) &&
            fromDetails > 0
            ? String(Math.ceil(fromDetails))
            : '60';
        })()
      : undefined;

  return NextResponse.json(toApiErrorBody(error, requestId), {
    status: error.status,
    headers: {
      ...NO_STORE_HEADERS,
      [REQUEST_ID_HEADER]: requestId,
      ...(retryAfter !== undefined ? { 'Retry-After': retryAfter } : {}),
    },
  });
}

export function jsonPaymentRequired<T>(
  body: T,
  requestId: string,
  paymentProtocolVersion: string,
): NextResponse {
  return NextResponse.json(body, {
    status: 402,
    headers: {
      ...NO_STORE_HEADERS,
      [REQUEST_ID_HEADER]: requestId,
      [PAYMENT_PROTOCOL_HEADER]: paymentProtocolVersion,
    },
  });
}
