import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { NextRequest } from 'next/server';

import {
  ADMIN_USERNAME,
  adminCredentialVersion,
  authenticateAdmin,
  ensureAdminAccount,
  getAdminAccount,
} from '@/server/application/admin/admin-auth';
import { middleware } from '@/middleware';
import {
  ADMIN_SESSION_COOKIE,
  createAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';
import { getServerEnv } from '@/server/config/env';
import { verifyPassword } from '@/server/infrastructure/auth/password-hash';
import { adminAccounts } from '@/server/infrastructure/db/schema';

import { createTestDb } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const env = getServerEnv();
const PASSWORD = env.ADMIN_PASSWORD;

describe.skipIf(PASSWORD.length === 0)('admin auth', () => {
  it('signs in the fixed Admin account and stores only a hash', async () => {
    const result = await authenticateAdmin(db, {
      username: ADMIN_USERNAME,
      password: PASSWORD,
    });
    expect(result).toMatchObject({ ok: true, admin: { username: 'Admin' } });

    const [row] = await db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.username, ADMIN_USERNAME));
    expect(row?.passwordHash).not.toContain(PASSWORD);
    expect(row?.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(row?.lastLoginAt).not.toBeNull();
  });

  it('rejects a wrong password or username identically', async () => {
    expect(
      await authenticateAdmin(db, {
        username: ADMIN_USERNAME,
        password: `${PASSWORD}x`,
      }),
    ).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(
      await authenticateAdmin(db, { username: 'admin', password: PASSWORD }),
    ).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('re-syncs the hash when ADMIN_PASSWORD changes', async () => {
    const account = await ensureAdminAccount(db);
    await db
      .update(adminAccounts)
      .set({ passwordHash: 'scrypt$0$0$0$stale$stale-hash-value' })
      .where(eq(adminAccounts.id, account?.id ?? ''));
    await ensureAdminAccount(db);
    const [row] = await db
      .select()
      .from(adminAccounts)
      .where(eq(adminAccounts.id, account?.id ?? ''));
    expect(await verifyPassword(PASSWORD, row?.passwordHash ?? '')).toBe(true);
  });

  it('keeps exactly one admin account', async () => {
    await Promise.all([ensureAdminAccount(db), ensureAdminAccount(db)]);
    const rows = await db.select().from(adminAccounts);
    expect(rows).toHaveLength(1);
  });
});

describe.skipIf(PASSWORD.length === 0)('admin sessions', () => {
  it('end when ADMIN_PASSWORD changes', async () => {
    const account = await ensureAdminAccount(db);
    if (account === null) throw new Error('expected the admin account');
    const session = {
      adminId: account.id,
      credentialVersion: adminCredentialVersion(),
    };
    expect(await getAdminAccount(db, session)).toMatchObject({
      username: 'Admin',
    });

    // The cached env is shared by the code under test; restore it after.
    env.ADMIN_PASSWORD = `${PASSWORD}-rotated-for-test`;
    try {
      expect(await getAdminAccount(db, session)).toBeNull();
    } finally {
      env.ADMIN_PASSWORD = PASSWORD;
    }
    expect(await getAdminAccount(db, session)).not.toBeNull();
  });
});

describe.skipIf(PASSWORD.length === 0)('admin middleware', () => {
  const at = (
    path: string,
    init?: ConstructorParameters<typeof NextRequest>[1],
  ) => new NextRequest(new URL(path, 'http://localhost:3000'), init);

  it('sends a signed-out page view to login, keeping its query', async () => {
    const response = await middleware(
      at('/admin/verification?verdict=unverified'),
    );
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.pathname).toBe('/admin/login');
    expect(location.searchParams.get('next')).toBe(
      '/admin/verification?verdict=unverified',
    );
  });

  it('keeps the public host from the proxy instead of the loopback bind', async () => {
    const response = await middleware(
      at('/admin', {
        headers: {
          'x-forwarded-host': 'arc-hackathon.openvpp.energy',
          'x-forwarded-proto': 'https',
        },
      }),
    );
    expect(response.headers.get('location')).toBe(
      'https://arc-hackathon.openvpp.energy/admin/login?next=%2Fadmin',
    );
  });

  it('lets a signed-out server action answer for itself', async () => {
    const response = await middleware(
      at('/admin/devices/x', {
        method: 'POST',
        headers: { 'next-action': 'abc123' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('never redirects the login page (the page decides)', async () => {
    const token = await createAdminSessionToken({
      adminId: '00000000-0000-0000-0000-000000000000',
      username: 'Admin',
      credentialVersion: 'stale',
      secret: env.API_KEY_HASH_SECRET,
    });
    const response = await middleware(
      at('/admin/login', {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      }),
    );
    expect(response.headers.get('location')).toBeNull();
  });

  it('404s every admin path when ADMIN_PASSWORD is empty', async () => {
    env.ADMIN_PASSWORD = '';
    try {
      for (const path of ['/admin', '/admin/login', '/admin/logout']) {
        expect((await middleware(at(path))).status).toBe(404);
      }
    } finally {
      env.ADMIN_PASSWORD = PASSWORD;
    }
  });
});
