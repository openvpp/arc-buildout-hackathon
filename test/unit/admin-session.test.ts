// @vitest-environment node
// jose (JWT) needs Node’s Uint8Array; jsdom’s cross-realm one is rejected.
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import { assertAdminPasswordSafe } from '@/server/config/env';
import {
  createAdminSessionToken,
  sanitizeAdminNextPath,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';
import { createDashboardSessionToken } from '@/server/infrastructure/auth/dashboard-session';

const SECRET = 'test-secret-that-is-long-enough-123';

describe('admin session', () => {
  it('round-trips the admin identity', async () => {
    const token = await createAdminSessionToken({
      adminId: 'a1',
      username: 'Admin',
      credentialVersion: 'cv1',
      secret: SECRET,
    });
    expect(await verifyAdminSessionToken({ token, secret: SECRET })).toEqual({
      ok: true,
      claims: { adminId: 'a1', username: 'Admin', credentialVersion: 'cv1' },
    });
  });

  it('rejects a session issued without a credential version', async () => {
    const legacy = await new SignJWT({ adminId: 'a1', username: 'Admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('arc-admin')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new Uint8Array(new TextEncoder().encode(SECRET)));
    expect(
      await verifyAdminSessionToken({ token: legacy, secret: SECRET }),
    ).toEqual({ ok: false });
  });

  it('rejects a dashboard user session and a wrong secret', async () => {
    const userToken = await createDashboardSessionToken({
      principalId: 'p1',
      subject: 'circle:user@example.com',
      walletId: 'w1',
      walletAddress: '0x0000000000000000000000000000000000000001',
      secret: SECRET,
    });
    expect(
      await verifyAdminSessionToken({ token: userToken, secret: SECRET }),
    ).toEqual({ ok: false });

    const token = await createAdminSessionToken({
      adminId: 'a1',
      username: 'Admin',
      credentialVersion: 'cv1',
      secret: SECRET,
    });
    expect(
      await verifyAdminSessionToken({ token, secret: `${SECRET}x` }),
    ).toEqual({ ok: false });
  });

  it('only redirects to same-origin admin pages after login', () => {
    expect(sanitizeAdminNextPath('/admin/devices/abc')).toBe(
      '/admin/devices/abc',
    );
    expect(sanitizeAdminNextPath('https://evil.example/admin')).toBe('/admin');
    expect(sanitizeAdminNextPath('//evil.example')).toBe('/admin');
    expect(sanitizeAdminNextPath('/admin/login')).toBe('/admin');
    expect(sanitizeAdminNextPath('/adminx')).toBe('/admin');
    expect(sanitizeAdminNextPath(undefined)).toBe('/admin');
    // A repeated ?next= arrives as an array: first value only, no crash.
    expect(
      sanitizeAdminNextPath(['/admin/devices', 'https://evil.example']),
    ).toBe('/admin/devices');
    expect(sanitizeAdminNextPath([])).toBe('/admin');
    expect(
      sanitizeAdminNextPath('/admin/verification?verdict=unverified'),
    ).toBe('/admin/verification?verdict=unverified');
  });
});

describe('assertAdminPasswordSafe (staging/production)', () => {
  it('refuses a demo-default or short password', () => {
    expect(() => assertAdminPasswordSafe('Admin123')).toThrow(/demo default/);
    expect(() => assertAdminPasswordSafe('short-pass1')).toThrow(/at least 12/);
    expect(() =>
      assertAdminPasswordSafe('a-long-unique-passphrase'),
    ).not.toThrow();
  });
});
