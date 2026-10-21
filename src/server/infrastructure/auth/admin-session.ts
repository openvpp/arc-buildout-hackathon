import { SignJWT, jwtVerify } from 'jose';

/**
 * Signed httpOnly cookie session for the admin console. Edge-safe (Web
 * Crypto via jose) so middleware can gate /admin. Its JWT subject differs
 * from the dashboard session's, so neither token is accepted as the other.
 */
export const ADMIN_SESSION_COOKIE = 'ev_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const ADMIN_SESSION_SUBJECT = 'arc-admin';

export type AdminSessionClaims = {
  readonly adminId: string;
  readonly username: string;
};

function sessionSecretKey(secret: string): Uint8Array {
  // Fresh Uint8Array: jose rejects cross-realm TypedArrays under vitest.
  return new Uint8Array(new TextEncoder().encode(secret));
}

export async function createAdminSessionToken(input: {
  readonly adminId: string;
  readonly username: string;
  readonly secret: string;
  readonly ttlSeconds?: number;
}): Promise<string> {
  return new SignJWT({ adminId: input.adminId, username: input.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADMIN_SESSION_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${input.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(sessionSecretKey(input.secret));
}

export async function verifyAdminSessionToken(input: {
  readonly token: string | undefined | null;
  readonly secret: string;
}): Promise<{ ok: true; claims: AdminSessionClaims } | { ok: false }> {
  if (input.token === undefined || input.token === null || input.token === '') {
    return { ok: false };
  }
  try {
    const { payload } = await jwtVerify(
      input.token,
      sessionSecretKey(input.secret),
      { algorithms: ['HS256'], subject: ADMIN_SESSION_SUBJECT },
    );
    const adminId = payload['adminId'];
    const username = payload['username'];
    if (
      typeof adminId !== 'string' ||
      adminId.length === 0 ||
      typeof username !== 'string' ||
      username.length === 0
    ) {
      return { ok: false };
    }
    return { ok: true, claims: { adminId, username } };
  } catch {
    return { ok: false };
  }
}

/** Safe post-login redirect: same-origin /admin paths only. */
export function sanitizeAdminNextPath(
  next: string | null | undefined,
): '/admin' | `/admin/${string}` {
  if (
    next === undefined ||
    next === null ||
    !next.startsWith('/admin') ||
    next.startsWith('//') ||
    next.includes('://') ||
    next.includes('\\') ||
    next.startsWith('/admin/login') ||
    next.startsWith('/admin/logout')
  ) {
    return '/admin';
  }
  if (next === '/admin') {
    return '/admin';
  }
  return next.startsWith('/admin/') ? (next as `/admin/${string}`) : '/admin';
}

type CookieOptions = {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: '/admin';
  readonly maxAge: number;
};

export function buildAdminSessionCookie(input: {
  readonly token: string;
  readonly secure: boolean;
}): { name: string; value: string; options: CookieOptions } {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: input.token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.secure,
      path: '/admin',
      maxAge: ADMIN_SESSION_TTL_SECONDS,
    },
  };
}

export function clearAdminSessionCookie(input: { readonly secure: boolean }): {
  name: string;
  value: string;
  options: CookieOptions;
} {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.secure,
      path: '/admin',
      maxAge: 0,
    },
  };
}
