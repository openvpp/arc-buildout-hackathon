import { describe, expect, it } from 'vitest';

import {
  adminNotConfiguredResponse,
  evaluateAdminPasswordLogin,
  timingSafeEqualString,
} from '@/server/infrastructure/auth/admin-basic-auth';

describe('timingSafeEqualString', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualString('admin', 'admin')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeEqualString('admin', 'admix')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqualString('admin', 'administrator')).toBe(false);
  });
});

describe('evaluateAdminPasswordLogin', () => {
  const credentials = { username: 'admin', password: 'secretpass' };

  it('returns 503 when admin credentials are not configured', () => {
    const decision = evaluateAdminPasswordLogin('admin', 'secretpass', null);
    expect(decision).toEqual({
      ok: false,
      status: 503,
      body: 'Admin is not configured',
    });
  });

  it('returns 401 for invalid username or password', () => {
    expect(evaluateAdminPasswordLogin('admin', 'wrong', credentials).ok).toBe(
      false,
    );
    expect(
      evaluateAdminPasswordLogin('other', 'secretpass', credentials).ok,
    ).toBe(false);
  });

  it('returns ok for matching credentials', () => {
    expect(
      evaluateAdminPasswordLogin('admin', 'secretpass', credentials),
    ).toEqual({ ok: true });
  });

  it('accepts passwords containing colons', () => {
    const withColon = { username: 'admin', password: 'sec:ret:pass' };
    expect(
      evaluateAdminPasswordLogin('admin', 'sec:ret:pass', withColon),
    ).toEqual({ ok: true });
  });
});

describe('adminNotConfiguredResponse', () => {
  it('returns 503 without a Basic Auth challenge', () => {
    const response = adminNotConfiguredResponse();
    expect(response.status).toBe(503);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
  });
});
