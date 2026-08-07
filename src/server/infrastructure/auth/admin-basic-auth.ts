/**
 * Credential check helpers for the super-admin UI.
 *
 * Pure evaluation helpers are Edge-safe (no node:crypto). Session cookie
 * issuance lives in admin-session.ts; this module validates username/password.
 */

export type AdminBasicCredentials = {
  readonly username: string;
  readonly password: string;
};

export type AdminAuthDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 401 | 503;
      readonly body: string;
    };

/** Edge-safe timing-aware string compare (rejects unequal lengths without leaking). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.length !== bBuf.length) {
    let sink = 0;
    for (let i = 0; i < aBuf.length; i += 1) {
      sink |= aBuf[i] ?? 0;
    }
    void sink;
    return false;
  }
  let result = 0;
  for (let i = 0; i < aBuf.length; i += 1) {
    result |= (aBuf[i] ?? 0) ^ (bBuf[i] ?? 0);
  }
  return result === 0;
}

/**
 * Evaluate form username/password against configured admin credentials.
 * When credentials are null, admin is not configured → 503 fail closed.
 */
export function evaluateAdminPasswordLogin(
  username: string,
  password: string,
  credentials: AdminBasicCredentials | null,
): AdminAuthDecision {
  if (credentials === null) {
    return {
      ok: false,
      status: 503,
      body: 'Admin is not configured',
    };
  }

  const userOk = timingSafeEqualString(username, credentials.username);
  const passOk = timingSafeEqualString(password, credentials.password);
  if (!userOk || !passOk) {
    return {
      ok: false,
      status: 401,
      body: 'Invalid credentials',
    };
  }

  return { ok: true };
}

export function adminNotConfiguredResponse(): Response {
  return new Response('Admin is not configured', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
