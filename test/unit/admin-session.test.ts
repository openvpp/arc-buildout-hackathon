/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE,
  buildAdminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  sanitizeAdminNextPath,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';

const SECRET = 'test-api-key-hash-secret-at-least-32-chars!!';

describe('admin session tokens', () => {
  it('creates a verifiable session token', async () => {
    const token = await createAdminSessionToken({
      username: 'admin',
      secret: SECRET,
    });
    const verified = await verifyAdminSessionToken({ token, secret: SECRET });
    expect(verified).toEqual({
      ok: true,
      claims: { username: 'admin' },
    });
  });

  it('rejects tokens signed with a different secret', async () => {
    const token = await createAdminSessionToken({
      username: 'admin',
      secret: SECRET,
    });
    const verified = await verifyAdminSessionToken({
      token,
      secret: 'different-secret-at-least-32-characters-long',
    });
    expect(verified).toEqual({ ok: false });
  });

  it('rejects missing tokens', async () => {
    expect(
      await verifyAdminSessionToken({ token: undefined, secret: SECRET }),
    ).toEqual({ ok: false });
  });
});

describe('sanitizeAdminNextPath', () => {
  it('allows /admin destinations and rejects open redirects', () => {
    expect(sanitizeAdminNextPath('/admin')).toBe('/admin');
    expect(sanitizeAdminNextPath('/admin/devices')).toBe('/admin/devices');
    expect(sanitizeAdminNextPath('/dashboard')).toBe('/admin');
    expect(sanitizeAdminNextPath('https://evil.example')).toBe('/admin');
    expect(sanitizeAdminNextPath('//evil.example')).toBe('/admin');
    expect(sanitizeAdminNextPath('/admin/login')).toBe('/admin');
    expect(sanitizeAdminNextPath('/admin/logout')).toBe('/admin');
  });
});

describe('admin session cookies', () => {
  it('scopes the session cookie to /admin', () => {
    const cookie = buildAdminSessionCookie({
      token: 'tok',
      secure: true,
    });
    expect(cookie.name).toBe(ADMIN_SESSION_COOKIE);
    expect(cookie.options.path).toBe('/admin');
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.secure).toBe(true);
  });

  it('clears the cookie with maxAge 0', () => {
    const cookie = clearAdminSessionCookie({ secure: false });
    expect(cookie.options.maxAge).toBe(0);
    expect(cookie.value).toBe('');
  });
});
