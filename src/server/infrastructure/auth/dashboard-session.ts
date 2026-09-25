import { SignJWT, jwtVerify } from 'jose';

/** Signed httpOnly cookie session for the dashboard. Edge-safe (Web Crypto via jose). */
export const DASHBOARD_SESSION_COOKIE = 'ev_dashboard_session';
export const DASHBOARD_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const DASHBOARD_SESSION_SUBJECT = 'dashboard-owner';

export type DashboardSessionClaims = {
  readonly principalId: string;
  readonly subject: string;
  readonly walletId: string;
  readonly walletAddress: string;
};

function sessionSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function createDashboardSessionToken(input: {
  readonly principalId: string;
  readonly subject: string;
  readonly walletId: string;
  readonly walletAddress: string;
  readonly secret: string;
  readonly ttlSeconds?: number;
}): Promise<string> {
  const ttl = input.ttlSeconds ?? DASHBOARD_SESSION_TTL_SECONDS;
  return new SignJWT({
    principalId: input.principalId,
    subject: input.subject,
    walletId: input.walletId,
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
    const walletId = payload['walletId'];
    const walletAddress = payload['walletAddress'];
    if (
      typeof principalId !== 'string' ||
      typeof subject !== 'string' ||
      typeof walletId !== 'string' ||
      typeof walletAddress !== 'string'
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      claims: { principalId, subject, walletId, walletAddress },
    };
  } catch {
    return { ok: false };
  }
}

export function buildDashboardSessionCookie(input: {
  token: string;
  secure: boolean;
}): { name: string; value: string; options: Record<string, unknown> } {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: input.token,
    options: {
      httpOnly: true,
      secure: input.secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: DASHBOARD_SESSION_TTL_SECONDS,
    },
  };
}

export function clearDashboardSessionCookie(input: { secure: boolean }): {
  name: string;
  value: string;
  options: Record<string, unknown>;
} {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      secure: input.secure,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0,
    },
  };
}
