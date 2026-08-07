/**
 * HTTP Basic Auth gate for the super-admin UI.
 *
 * Pure evaluation helpers are Edge-safe (no node:crypto). Response builders are
 * used by middleware and the (admin) layout.
 */

export const ADMIN_BASIC_REALM = 'EV Telemetry Admin';

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

function parseBasicAuthorization(
  authorizationHeader: string | null,
): AdminBasicCredentials | null {
  if (authorizationHeader === null) {
    return null;
  }
  const match = /^Basic\s+(\S+)$/i.exec(authorizationHeader.trim());
  if (match === null) {
    return null;
  }
  const encoded = match[1];
  if (encoded === undefined || encoded.length === 0) {
    return null;
  }

  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }

  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  };
}

/**
 * Evaluate Basic Auth against configured admin credentials.
 * When credentials are null, admin is not configured → 503 fail closed.
 */
export function evaluateAdminBasicAuth(
  authorizationHeader: string | null,
  credentials: AdminBasicCredentials | null,
): AdminAuthDecision {
  if (credentials === null) {
    return {
      ok: false,
      status: 503,
      body: 'Admin is not configured',
    };
  }

  const provided = parseBasicAuthorization(authorizationHeader);
  if (provided === null) {
    return {
      ok: false,
      status: 401,
      body: 'Authentication required',
    };
  }

  const userOk = timingSafeEqualString(provided.username, credentials.username);
  const passOk = timingSafeEqualString(provided.password, credentials.password);
  if (!userOk || !passOk) {
    return {
      ok: false,
      status: 401,
      body: 'Invalid credentials',
    };
  }

  return { ok: true };
}

export function adminAuthFailureResponse(
  decision: Extract<AdminAuthDecision, { ok: false }>,
): Response {
  const headers = new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  if (decision.status === 401) {
    headers.set(
      'WWW-Authenticate',
      `Basic realm="${ADMIN_BASIC_REALM}", charset="UTF-8"`,
    );
  }
  return new Response(decision.body, {
    status: decision.status,
    headers,
  });
}

/**
 * Logout endpoint response. Intentionally omits WWW-Authenticate so the
 * browser is not immediately re-prompted; the HTML body redirects away from
 * /admin. The next visit to /admin challenges again.
 */
export function adminLogoutResponse(): Response {
  const html =
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>' +
    '<meta http-equiv="refresh" content="0;url=/dashboard"/>' +
    '<title>Logged out</title>' +
    '<script>location.replace("/dashboard")</script></head>' +
    '<body><p>Logged out. <a href="/dashboard">Continue to dashboard</a>.</p>' +
    '</body></html>';
  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
