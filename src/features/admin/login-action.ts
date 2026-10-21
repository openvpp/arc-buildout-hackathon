'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { authenticateAdmin } from '@/server/application/admin/admin-auth';
import { getServerEnv } from '@/server/config/env';
import {
  buildAdminSessionCookie,
  createAdminSessionToken,
  sanitizeAdminNextPath,
} from '@/server/infrastructure/auth/admin-session';
import { isSecureSessionCookie } from '@/server/infrastructure/auth/dashboard-session';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';

export type AdminLoginState = { readonly error: string | null };

export async function loginAdmin(
  _previous: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  try {
    enforceRateLimit({
      request: new Request('http://local/admin/login', {
        headers: await headers(),
      }),
      bucket: 'admin-login',
      limit: 10,
      windowMs: 10 * 60 * 1000,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error: 'Too many sign-in attempts. Try again in a few minutes.',
      };
    }
    throw error;
  }

  const username = String(formData.get('username') ?? '').slice(0, 64);
  const password = String(formData.get('password') ?? '').slice(0, 256);
  const next = sanitizeAdminNextPath(String(formData.get('next') ?? ''));

  const result = await authenticateAdmin(getDb(), { username, password });
  if (!result.ok) {
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
