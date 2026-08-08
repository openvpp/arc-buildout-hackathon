/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  DASHBOARD_SESSION_COOKIE,
  buildDashboardSessionCookie,
  clearDashboardSessionCookie,
  createDashboardSessionToken,
  verifyDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';

const SECRET = 'test-api-key-hash-secret-at-least-32-chars!!';

describe('dashboard session tokens', () => {
  it('creates a verifiable session token', async () => {
    const token = await createDashboardSessionToken({
      principalId: '11111111-1111-1111-1111-111111111111',
      subject: 'user-sub',
      walletAddress: '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01',
      secret: SECRET,
    });
    const verified = await verifyDashboardSessionToken({
      token,
      secret: SECRET,
    });
    expect(verified).toEqual({
      ok: true,
      claims: {
        principalId: '11111111-1111-1111-1111-111111111111',
        subject: 'user-sub',
        walletAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
      },
    });
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await createDashboardSessionToken({
      principalId: '11111111-1111-1111-1111-111111111111',
      subject: 'user-sub',
      walletAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
      secret: SECRET,
    });
    expect(
      await verifyDashboardSessionToken({
        token,
        secret: 'different-secret-at-least-32-characters-long',
      }),
    ).toEqual({ ok: false });
  });

  it('rejects missing tokens', async () => {
    expect(
      await verifyDashboardSessionToken({
        token: undefined,
        secret: SECRET,
      }),
    ).toEqual({ ok: false });
  });
});

describe('dashboard session cookies', () => {
  it('scopes the session cookie to /', () => {
    const cookie = buildDashboardSessionCookie({
      token: 'tok',
      secure: true,
    });
    expect(cookie.name).toBe(DASHBOARD_SESSION_COOKIE);
    expect(cookie.options.path).toBe('/');
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
  });

  it('clears the cookie with maxAge 0', () => {
    const cookie = clearDashboardSessionCookie({ secure: false });
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.value).toBe('');
  });
});
