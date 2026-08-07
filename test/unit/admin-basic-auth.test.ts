import { describe, expect, it } from 'vitest';

import {
  ADMIN_BASIC_REALM,
  adminAuthFailureResponse,
  evaluateAdminBasicAuth,
  timingSafeEqualString,
} from '@/server/infrastructure/auth/admin-basic-auth';

function basicHeader(username: string, password: string): string {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

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

describe('evaluateAdminBasicAuth', () => {
  const credentials = { username: 'admin', password: 'secretpass' };

  it('returns 503 when admin credentials are not configured', () => {
    const decision = evaluateAdminBasicAuth(
      basicHeader('admin', 'secretpass'),
      null,
    );
    expect(decision).toEqual({
      ok: false,
      status: 503,
      body: 'Admin is not configured',
    });
  });

  it('returns 401 when Authorization header is missing', () => {
    const decision = evaluateAdminBasicAuth(null, credentials);
    expect(decision.ok).toBe(false);
    if (decision.ok) {
      return;
    }
    expect(decision.status).toBe(401);
  });

  it('returns 401 for malformed Basic credentials', () => {
    const decision = evaluateAdminBasicAuth('Bearer token', credentials);
    expect(decision.ok).toBe(false);
    if (decision.ok) {
      return;
    }
    expect(decision.status).toBe(401);
  });

  it('returns 401 for invalid username or password', () => {
    expect(
      evaluateAdminBasicAuth(basicHeader('admin', 'wrong'), credentials).ok,
    ).toBe(false);
    expect(
      evaluateAdminBasicAuth(basicHeader('other', 'secretpass'), credentials)
        .ok,
    ).toBe(false);
  });

  it('returns ok for matching credentials', () => {
    expect(
      evaluateAdminBasicAuth(basicHeader('admin', 'secretpass'), credentials),
    ).toEqual({ ok: true });
  });

  it('accepts passwords containing colons', () => {
    const withColon = { username: 'admin', password: 'sec:ret:pass' };
    expect(
      evaluateAdminBasicAuth(basicHeader('admin', 'sec:ret:pass'), withColon),
    ).toEqual({ ok: true });
  });
});

describe('adminAuthFailureResponse', () => {
  it('sets WWW-Authenticate on 401 challenges', () => {
    const response = adminAuthFailureResponse({
      ok: false,
      status: 401,
      body: 'Authentication required',
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain(
      ADMIN_BASIC_REALM,
    );
  });

  it('omits WWW-Authenticate on 503 not-configured responses', () => {
    const response = adminAuthFailureResponse({
      ok: false,
      status: 503,
      body: 'Admin is not configured',
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
  });
});
