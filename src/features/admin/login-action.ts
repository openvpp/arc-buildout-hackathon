'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getAdminBasicCredentials, getServerEnv } from '@/server/config/env';
import { evaluateAdminPasswordLogin } from '@/server/infrastructure/auth/admin-basic-auth';
import {
  buildAdminSessionCookie,
  createAdminSessionToken,
  sanitizeAdminNextPath,
} from '@/server/infrastructure/auth/admin-session';

export type AdminLoginState = {
  readonly error: string | null;
};

export async function loginAdmin(
  _previous: AdminLoginState,
  formData: FormData,
): Promise<AdminLoginState> {
  const username = String(formData.get('username') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = sanitizeAdminNextPath(String(formData.get('next') ?? ''));

  const credentials = getAdminBasicCredentials();
  const decision = evaluateAdminPasswordLogin(username, password, credentials);

  if (!decision.ok) {
    if (decision.status === 503) {
      return { error: 'Admin is not configured on this environment.' };
    }
    return { error: 'Invalid username or password.' };
  }

  if (credentials === null) {
    return { error: 'Admin is not configured on this environment.' };
  }

  const env = getServerEnv();
  const token = await createAdminSessionToken({
    username: credentials.username,
    secret: env.API_KEY_HASH_SECRET,
  });

  const secure = env.APP_ENV === 'production' || env.APP_ENV === 'staging';
  const cookie = buildAdminSessionCookie({ token, secure });
  (await cookies()).set(cookie.name, cookie.value, cookie.options);

  redirect(next);
}
