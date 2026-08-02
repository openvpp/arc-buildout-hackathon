import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/errors';
import { unwrapApiResult } from '@/lib/api/unwrap';

describe('unwrapApiResult', () => {
  it('returns data for a successful result', () => {
    expect(
      unwrapApiResult({ ok: true, data: { value: 1 }, requestId: 'r' }),
    ).toEqual({ value: 1 });
  });

  it('throws the normalized error for a failed result', () => {
    const error = new ApiError({ kind: 'http', message: 'boom', status: 500 });
    expect(() => unwrapApiResult({ ok: false, error })).toThrow(error);
  });
});
