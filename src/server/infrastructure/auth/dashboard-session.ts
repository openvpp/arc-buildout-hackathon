import { SignJWT, jwtVerify } from 'jose';

/**
 * Signed httpOnly cookie session for the owner dashboard RSC.
 * Edge-safe (Web Crypto via jose). Signing secret is API_KEY_HASH_SECRET.
 */

export const DASHBOARD_SESSION_COOKIE = 'ev_dashboard_session';
export const DASHBOARD_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const DASHBOARD_SESSION_SUBJECT = 'dashboard-owner';

export type DashboardSessionClaims = {
  readonly principalId: string;
  readonly subject: string;
  readonly walletAddress: string;
};

function sessionSecretKey(secret: string): Uint8Array {
  const encoded = new TextEncoder().encode(secret);
  return new Uint8Array(encoded);
}

export async function createDashboardSessionToken(input: {
  readonly principalId: string;
  readonly subject: string;
  readonly walletAddress: string;
  readonly secret: string;
  readonly ttlSeconds?: number;
}): Promise<string> {
  const ttl = input.ttlSeconds ?? DASHBOARD_SESSION_TTL_SECONDS;
  return new SignJWT({
    principalId: input.principalId,
    subject: input.subject,
    walletAddress: input.walletAddress.toLowerCase(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(DASHBOARD_SESSION_SUBJECT)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(sessionSecretKey(input.secret));
}

export async function verifyDashboardSessionToken(input: {
  readonly token: string | undefined | null;
  readonly secret: string;
}): Promise<{ ok: true; claims: DashboardSessionClaims } | { ok: false }> {
  if (input.token === undefined || input.token === null || input.token === '') {
    return { ok: false };
  }
  try {
    const { payload } = await jwtVerify(
      input.token,
      sessionSecretKey(input.secret),
      {
        algorithms: ['HS256'],
        subject: DASHBOARD_SESSION_SUBJECT,
      },
    );
    const principalId = payload['principalId'];
    const subject = payload['subject'];
    const walletAddress = payload['walletAddress'];
    if (
      typeof principalId !== 'string' ||
      principalId.length === 0 ||
      typeof subject !== 'string' ||
      subject.length === 0 ||
      typeof walletAddress !== 'string' ||
      walletAddress.length === 0
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      claims: {
        principalId,
        subject,
        walletAddress: walletAddress.toLowerCase(),
      },
    };
  } catch {
    return { ok: false };
  }
}

export function buildDashboardSessionCookie(input: {
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
    readonly path: '/';
    readonly maxAge: number;
  };
} {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: input.token,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.secure,
      path: '/',
      maxAge: input.maxAgeSeconds ?? DASHBOARD_SESSION_TTL_SECONDS,
    },
  };
}

export function clearDashboardSessionCookie(input: {
  readonly secure: boolean;
}): {
  readonly name: string;
  readonly value: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: 'lax';
    readonly secure: boolean;
    readonly path: '/';
    readonly maxAge: 0;
  };
} {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax',
      secure: input.secure,
      path: '/',
      maxAge: 0,
    },
  };
}
