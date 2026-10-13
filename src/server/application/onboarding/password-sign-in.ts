import { and, eq } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import {
  bindDashboardOwner,
  dashboardPrincipalDisplayName,
  type BoundIdentity,
} from '@/server/application/onboarding/bind-dashboard-owner';
import {
  hashPassword,
  verifyPassword,
} from '@/server/infrastructure/auth/password-hash';
import type { Database } from '@/server/infrastructure/db/client';
import {
  dashboardPasswordCredentials,
  principals,
} from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'password-sign-in' });

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const EMAIL_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

const ACCOUNT_EXISTS_MESSAGE =
  'An account with this email already exists. Sign in instead.';
const INVALID_LOGIN_MESSAGE = 'Email or password is incorrect.';

let dummyHash: Promise<string> | null = null;

function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password');
  return dummyHash;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (
    normalized.length < 3 ||
    normalized.length > 320 ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    throw new ApplicationError('EMAIL_INVALID', 'Enter a valid email address.');
  }
  return normalized;
}

function assertNewPassword(password: string): void {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    throw new ApplicationError(
      'PASSWORD_INVALID',
      'Password must be 8 to 128 characters.',
    );
  }
}

async function openWallet(
  email: string,
  db: Database,
  purpose: 'register' | 'login',
): Promise<BoundIdentity> {
  try {
    return await bindDashboardOwner(db, { email });
  } catch (error) {
    if (error instanceof ApplicationError) {
      throw error;
    }
    log.error('password_sign_in.wallet_failed', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw new ApplicationError(
      'WALLET_OPEN_FAILED',
      purpose === 'register'
        ? 'Your account was created, but the wallet could not be opened. Sign in to retry.'
        : 'The wallet could not be opened. Try again.',
    );
  }
}

/**
 * Create the password account, then find-or-create its Circle wallet.
 * Refuses when that email already has a principal, including a Google-only
 * one, so a password cannot be stuck onto someone else's wallet.
 */
export async function registerWithPassword(
  db: Database,
  input: { email: string; password: string },
): Promise<BoundIdentity> {
  const email = assertEmail(input.email);
  assertNewPassword(input.password);
  const passwordHash = await hashPassword(input.password);
  const displayName = dashboardPrincipalDisplayName(email);

  await db.transaction(async (tx) => {
    const [existingCredential] = await tx
      .select({ principalId: dashboardPasswordCredentials.principalId })
      .from(dashboardPasswordCredentials)
      .where(eq(dashboardPasswordCredentials.email, email))
      .limit(1);
    if (existingCredential !== undefined) {
      throw new ApplicationError('ACCOUNT_EXISTS', ACCOUNT_EXISTS_MESSAGE);
    }

    const [existingPrincipal] = await tx
      .select({ id: principals.id })
      .from(principals)
      .where(
        and(
          eq(principals.type, 'dashboard_user'),
          eq(principals.displayName, displayName),
        ),
      )
      .limit(1);
    if (existingPrincipal !== undefined) {
      throw new ApplicationError('ACCOUNT_EXISTS', ACCOUNT_EXISTS_MESSAGE);
    }

    const [created] = await tx
      .insert(principals)
      .values({ type: 'dashboard_user', displayName, status: 'active' })
      .onConflictDoNothing({
        target: [principals.type, principals.displayName],
      })
      .returning({ id: principals.id });
    if (created === undefined) {
      throw new ApplicationError('ACCOUNT_EXISTS', ACCOUNT_EXISTS_MESSAGE);
    }

    await tx.insert(dashboardPasswordCredentials).values({
      principalId: created.id,
      email,
      passwordHash,
    });
  });

  return openWallet(email, db, 'register');
}

/**
 * Open the Circle wallet for an email whose password hash matches.
 * Missing accounts and wrong passwords return the same error.
 */
export async function signInWithPassword(
  db: Database,
  input: { email: string; password: string },
): Promise<BoundIdentity> {
  const email = normalizeEmail(input.email);
  const passwordUsable =
    EMAIL_PATTERN.test(email) &&
    email.length <= 320 &&
    input.password.length >= 1 &&
    input.password.length <= PASSWORD_MAX_LENGTH;

  const [credential] = passwordUsable
    ? await db
        .select({
          passwordHash: dashboardPasswordCredentials.passwordHash,
        })
        .from(dashboardPasswordCredentials)
        .where(eq(dashboardPasswordCredentials.email, email))
        .limit(1)
    : [];

  const hash = credential?.passwordHash ?? (await dummyPasswordHash());
  const password = passwordUsable ? input.password : 'invalid';
  const matches = await verifyPassword(password, hash);
  if (credential === undefined || !matches) {
    throw new ApplicationError('INVALID_LOGIN', INVALID_LOGIN_MESSAGE);
  }

  return openWallet(email, db, 'login');
}
