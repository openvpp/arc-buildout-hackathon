import { createHash, randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationError } from '@/server/application/application-error';
import { dashboardPrincipalDisplayName } from '@/server/application/onboarding/bind-dashboard-owner';
import {
  registerWithPassword,
  signInWithPassword,
} from '@/server/application/onboarding/password-sign-in';
import { ensureCircleWallet } from '@/server/infrastructure/circle/circle-wallet-client';
import {
  dashboardPasswordCredentials,
  principals,
} from '@/server/infrastructure/db/schema';

import { createTestDb } from './test-helpers';

vi.mock('@/server/infrastructure/circle/circle-wallet-client', () => ({
  ensureCircleWallet: vi.fn(async (input: { refId: string }) => {
    const hash = createHash('sha256')
      .update(input.refId)
      .digest('hex')
      .slice(0, 40);
    return {
      circleWalletId: hash,
      address: `0x${hash}`,
      blockchain: 'ARC-TESTNET',
    };
  }),
}));

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

beforeEach(() => {
  vi.mocked(ensureCircleWallet).mockClear();
});

describe('password sign-in', () => {
  it('creates one wallet and opens it again with the same password', async () => {
    const created = await registerWithPassword(db, {
      email: 'Owner@Example.com',
      password: 'correct-horse',
    });
    const signedIn = await signInWithPassword(db, {
      email: 'owner@example.com',
      password: 'correct-horse',
    });

    expect(signedIn).toEqual(created);
    expect(vi.mocked(ensureCircleWallet)).toHaveBeenCalledTimes(2);
    const credentials = await db
      .select({ email: dashboardPasswordCredentials.email })
      .from(dashboardPasswordCredentials)
      .where(eq(dashboardPasswordCredentials.email, 'owner@example.com'));
    expect(credentials).toHaveLength(1);
  });

  it('does not attach a password to an existing principal', async () => {
    const email = `taken-${randomUUID()}@example.com`;
    await db.insert(principals).values({
      type: 'dashboard_user',
      displayName: dashboardPrincipalDisplayName(email),
      status: 'active',
    });

    await expect(
      registerWithPassword(db, { email, password: 'correct-horse' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_EXISTS' });
    expect(vi.mocked(ensureCircleWallet)).not.toHaveBeenCalled();
    const credentials = await db
      .select({ email: dashboardPasswordCredentials.email })
      .from(dashboardPasswordCredentials)
      .where(eq(dashboardPasswordCredentials.email, email));
    expect(credentials).toHaveLength(0);
  });

  it('rejects a second registration and a wrong password the same way a missing account does', async () => {
    const email = `member-${randomUUID()}@example.com`;
    await registerWithPassword(db, { email, password: 'correct-horse' });

    await expect(
      registerWithPassword(db, { email, password: 'another-horse' }),
    ).rejects.toBeInstanceOf(ApplicationError);

    await expect(
      signInWithPassword(db, { email, password: 'wrong-horse' }),
    ).rejects.toMatchObject({
      code: 'INVALID_LOGIN',
      message: 'Email or password is incorrect.',
    });
    await expect(
      signInWithPassword(db, {
        email: 'nobody@example.com',
        password: 'correct-horse',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_LOGIN',
      message: 'Email or password is incorrect.',
    });
  });

  it('rejects a short password before creating an account', async () => {
    await expect(
      registerWithPassword(db, {
        email: 'short@example.com',
        password: 'tiny',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_INVALID' });
    const rows = await db
      .select({ id: principals.id })
      .from(principals)
      .where(
        eq(
          principals.displayName,
          dashboardPrincipalDisplayName('short@example.com'),
        ),
      );
    expect(rows).toHaveLength(0);
  });
});
