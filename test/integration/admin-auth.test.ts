import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import {
  ADMIN_USERNAME,
  authenticateAdmin,
  ensureAdminAccount,
} from '@/server/application/admin/admin-auth';
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
