import { describe, expect, it } from 'vitest';

import {
  ApiError,
  isApiError,
  isPaymentRequired,
  normalizeError,
} from '@/lib/api/errors';

describe('normalizeError', () => {
  it('returns an existing ApiError unchanged', () => {
    const original = new ApiError({
      kind: 'http',
      message: 'nope',
      status: 500,
    });
    expect(normalizeError(original)).toBe(original);
  });

  it('maps an AbortError DOMException to kind "aborted"', () => {
    const aborted = new DOMException('aborted', 'AbortError');
    expect(normalizeError(aborted).kind).toBe('aborted');
  });

  it('maps a TypeError to a network error', () => {
    expect(normalizeError(new TypeError('failed to fetch')).kind).toBe(
      'network',
    );
  });

  it('maps a generic Error to kind "unknown" preserving the message', () => {
    const normalized = normalizeError(new Error('boom'));
    expect(normalized.kind).toBe('unknown');
    expect(normalized.message).toBe('boom');
  });

  it('maps a non-Error value to kind "unknown"', () => {
    expect(normalizeError('a string').kind).toBe('unknown');
  });
});

describe('isApiError', () => {
  it('detects ApiError instances', () => {
    expect(isApiError(new ApiError({ kind: 'network', message: 'x' }))).toBe(
      true,
    );
    expect(isApiError(new Error('x'))).toBe(false);
  });
});

describe('isPaymentRequired', () => {
  it('treats a 402 ApiError as an expected payment-required response', () => {
    const error = new ApiError({ kind: 'http', message: 'pay', status: 402 });
    expect(isPaymentRequired(error)).toBe(true);
  });

  it('is false for other statuses and non-ApiErrors', () => {
    expect(
      isPaymentRequired(
        new ApiError({ kind: 'http', message: 'x', status: 500 }),
      ),
    ).toBe(false);
    expect(isPaymentRequired(new Error('x'))).toBe(false);
  });
});
