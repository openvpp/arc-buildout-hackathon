import { SignJWT, jwtVerify } from 'jose';

/**
 * Signed httpOnly cookie session for the super-admin UI.
 * Edge-safe (Web Crypto via jose). Signing secret is API_KEY_HASH_SECRET.
 */

export const ADMIN_SESSION_COOKIE = 'ev_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const ADMIN_SESSION_SUBJECT = 'super-admin';

export type AdminSessionClaims = {
  readonly username: string;
};

function sessionSecretKey(secret: string): Uint8Array {
  // Copy into a fresh Uint8Array so jose accepts the key under jsdom/vitest
  // (cross-realm TypedArray instances fail the jose instanceof check).
  const encoded = new TextEncoder().encode(secret);
  return new Uint8Array(encoded);
}

export async function createAdminSessionToken(input: {
  readonly username: string;
  readonly secret: string;
  readonly ttlSeconds?: number;
}): Promise<string> {
  const ttl = input.ttlSeconds ?? ADMIN_SESSION_TTL_SECONDS;
  return new SignJWT({ username: input.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ADMIN_SESSION_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
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
      {
        algorithms: ['HS256'],
        subject: ADMIN_SESSION_SUBJECT,
      },
    );
    const username = payload['username'];
    if (typeof username !== 'string' || username.length === 0) {
      return { ok: false };
    }
    return { ok: true, claims: { username } };
  } catch {
    return { ok: false };
  }
}

/** Safe post-login redirect: only same-origin /admin paths (not login/logout). */
export function sanitizeAdminNextPath(
  next: string | null | undefined,
): '/admin' | `/admin/${string}` {
  if (next === undefined || next === null || next.length === 0) {
    return '/admin';
  }
  if (!next.startsWith('/admin')) {
    return '/admin';
  }
  if (next.startsWith('//') || next.includes('://')) {
    return '/admin';
  }
  if (next === '/admin/login' || next.startsWith('/admin/login?')) {
    return '/admin';
  }
  if (next === '/admin/logout' || next.startsWith('/admin/logout?')) {
    return '/admin';
  }
  return next as `/admin/${string}`;
}

export function buildAdminSessionCookie(input: {
  readonly token: string;
  readonly secure: boolean;
  readonly maxAgeSeconds?: number;
}): {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: 'lax';
    readonly secure: boolean;
    readonly path: '/admin';
    readonly maxAge: number;
  };
} {
  return {
    name: ADMIN_SESSION_COOKIE,
    value: input.token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.secure,
      path: '/admin',
      maxAge: input.maxAgeSeconds ?? ADMIN_SESSION_TTL_SECONDS,
    },
  };
}

export function clearAdminSessionCookie(input: { readonly secure: boolean }): {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: 'lax';
    readonly secure: boolean;
    readonly path: '/admin';
    readonly maxAge: 0;
  };
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
