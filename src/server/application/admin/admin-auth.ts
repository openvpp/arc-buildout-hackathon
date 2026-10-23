import { createHmac, timingSafeEqual } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import {
  hashPassword,
  verifyPassword,
} from '@/server/infrastructure/auth/password-hash';
import type { Database } from '@/server/infrastructure/db/client';
import { adminAccounts } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'admin-auth' });

/** The admin role has exactly one, fixed account. */
export const ADMIN_USERNAME = 'Admin';

export type AdminAccount = { id: string; username: string };

/** An empty ADMIN_PASSWORD disables the admin console entirely. */
export function isAdminConfigured(): boolean {
  return getServerEnv().ADMIN_PASSWORD.length > 0;
}

/**
 * Fingerprint of the current admin credential, carried in each session.
 * Changing ADMIN_PASSWORD changes it, which ends every existing session at
 * its next request. Keyed, so it reveals nothing about the password.
 */
export function adminCredentialVersion(): string {
  const env = getServerEnv();
  return createHmac('sha256', env.API_KEY_HASH_SECRET)
    .update(`admin-credential:${ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`)
    .digest('hex')
    .slice(0, 32);
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Ensures the `Admin` row exists and its stored hash matches the current
 * ADMIN_PASSWORD (rotating the env value rotates the hash). The password
 * itself is never stored.
 */
export async function ensureAdminAccount(
  db: Database,
): Promise<AdminAccount | null> {
  const password = getServerEnv().ADMIN_PASSWORD;
  if (password.length === 0) {
    return null;
  }
  const [existing] = await db
    .select()
    .from(adminAccounts)
    .where(eq(adminAccounts.username, ADMIN_USERNAME))
    .limit(1);
  if (existing !== undefined) {
    if (!(await verifyPassword(password, existing.passwordHash))) {
      await db
        .update(adminAccounts)
        .set({
          passwordHash: await hashPassword(password),
          updatedAt: new Date(),
        })
        .where(eq(adminAccounts.id, existing.id));
      log.info('admin.password_rotated', { username: ADMIN_USERNAME });
    }
    return { id: existing.id, username: existing.username };
  }
  const [created] = await db
    .insert(adminAccounts)
    .values({
      username: ADMIN_USERNAME,
      passwordHash: await hashPassword(password),
    })
    .onConflictDoNothing({ target: adminAccounts.username })
    .returning({ id: adminAccounts.id, username: adminAccounts.username });
  if (created !== undefined) {
    return created;
  }
  const [raced] = await db
    .select({ id: adminAccounts.id, username: adminAccounts.username })
    .from(adminAccounts)
    .where(eq(adminAccounts.username, ADMIN_USERNAME))
    .limit(1);
  return raced ?? null;
}

export type AdminLoginResult =
  | { ok: true; admin: AdminAccount }
  | { ok: false; reason: 'not_configured' | 'invalid_credentials' };

/** Checks username + password against the stored hash (never the env). */
export async function authenticateAdmin(
  db: Database,
  input: { username: string; password: string },
): Promise<AdminLoginResult> {
  const account = await ensureAdminAccount(db);
  if (account === null) {
    return { ok: false, reason: 'not_configured' };
  }
  const [row] = await db
    .select()
    .from(adminAccounts)
    .where(eq(adminAccounts.id, account.id))
    .limit(1);
  // Always run the hash check so a wrong username costs the same time.
  const passwordOk =
    row !== undefined &&
    (await verifyPassword(input.password, row.passwordHash));
  const usernameOk = sameText(input.username, ADMIN_USERNAME);
  if (!passwordOk || !usernameOk) {
    // Never log the attempted password; the username is not secret.
    log.warn('admin.login_failed', {
      usernameMatches: usernameOk,
    });
    return { ok: false, reason: 'invalid_credentials' };
  }
  await db
    .update(adminAccounts)
    .set({ lastLoginAt: new Date() })
    .where(eq(adminAccounts.id, account.id));
  log.info('admin.login', { username: ADMIN_USERNAME });
  return { ok: true, admin: account };
}

/**
 * The session's admin still exists and the session was issued under the
 * current password (defense in depth after middleware, which only checks
 * the signature).
 */
export async function getAdminAccount(
  db: Database,
  session: { adminId: string; credentialVersion: string },
): Promise<AdminAccount | null> {
  if (
    !isAdminConfigured() ||
    !sameText(session.credentialVersion, adminCredentialVersion())
  ) {
    return null;
  }
  const adminId = session.adminId;
  const [row] = await db
    .select({ id: adminAccounts.id, username: adminAccounts.username })
    .from(adminAccounts)
    .where(eq(adminAccounts.id, adminId))
    .limit(1);
  return row ?? null;
}
