'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  adminCredentialVersion,
  authenticateAdmin,
} from '@/server/application/admin/admin-auth';
import { getServerEnv } from '@/server/config/env';
import {
  buildAdminSessionCookie,
  createAdminSessionToken,
  sanitizeAdminNextPath,
} from '@/server/infrastructure/auth/admin-session';
import { isSecureSessionCookie } from '@/server/infrastructure/auth/dashboard-session';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import {
  enforceRateLimit,
  isRateLimited,
  recordRateLimitHit,
} from '@/server/transport/http/rate-limit';

export type AdminLoginState = { readonly error: string | null };

/**
 * There is one admin account, so failures are also limited across every
 * caller: rotating IPs cannot buy more guesses. (Per-process, like every
 * limiter here — see rate-limit.ts.)
 */
const FAILED_LOGIN_KEY = 'admin-login-failures:Admin';
const FAILED_LOGIN_LIMIT = 30;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

const TOO_MANY = 'Too many sign-in attempts. Try again in a few minutes.';

export async function loginAdmin(
  _previous: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  if (
    isRateLimited({
      key: FAILED_LOGIN_KEY,
      limit: FAILED_LOGIN_LIMIT,
      windowMs: LOGIN_WINDOW_MS,
    })
  ) {
    return { error: TOO_MANY };
  }
  try {
    enforceRateLimit({
      request: new Request('http://local/admin/login', {
        headers: await headers(),
      }),
      bucket: 'admin-login',
      limit: 10,
      windowMs: LOGIN_WINDOW_MS,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: TOO_MANY };
    }
    throw error;
  }

  const username = String(formData.get('username') ?? '').slice(0, 64);
  const password = String(formData.get('password') ?? '').slice(0, 256);
  const next = sanitizeAdminNextPath(String(formData.get('next') ?? ''));

  const result = await authenticateAdmin(getDb(), { username, password });
  if (!result.ok) {
    if (result.reason === 'invalid_credentials') {
      recordRateLimitHit({ key: FAILED_LOGIN_KEY, windowMs: LOGIN_WINDOW_MS });
    }
    return {
      error:
        result.reason === 'not_configured'
          ? 'Admin is not configured on this environment.'
          : 'Invalid username or password.',
    };
  }

  const env = getServerEnv();
  const token = await createAdminSessionToken({
    adminId: result.admin.id,
    username: result.admin.username,
    credentialVersion: adminCredentialVersion(),
    secret: env.API_KEY_HASH_SECRET,
  });
  const cookie = buildAdminSessionCookie({
    token,
    secure: isSecureSessionCookie({
      appEnv: env.APP_ENV,
      nodeEnv: process.env.NODE_ENV,
    }),
  });
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  redirect(next);
}
