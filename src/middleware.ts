import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getServerEnv } from '@/server/config/env';
import {
  ADMIN_SESSION_COOKIE,
  clearAdminSessionCookie,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

/** Next.js marks server-action POSTs with this header. */
const SERVER_ACTION_HEADER = 'next-action';

function adminHeaders(response: NextResponse): NextResponse {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}

const FORWARDED_HOST = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/;

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim() ?? '';
  return first.length > 0 ? first : null;
}

/**
 * Redirects must use the public host. Behind Caddy, `request.url` is the
 * loopback address Next is bound to (`https://localhost:3000`), so a
 * redirect built from it sends the browser off the public site. The app
 * only listens on loopback, so the proxy's forwarded host is the client
 * host.
 */
function adminRedirectUrl(request: NextRequest, pathname: string): URL {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = '';
  const forwardedHost = firstHeaderValue(
    request.headers.get('x-forwarded-host'),
  );
  const host =
    forwardedHost === null ? null : FORWARDED_HOST.exec(forwardedHost);
  if (host !== null) {
    url.hostname = host[1] ?? '';
    // Drop the loopback port (3000) unless the proxy named one.
    url.port = host[2] ?? '';
  }
  const forwardedProto = firstHeaderValue(
    request.headers.get('x-forwarded-proto'),
  );
  if (forwardedProto === 'http' || forwardedProto === 'https') {
    url.protocol = `${forwardedProto}:`;
  }
  return url;
}

/**
 * Cookie-session gate for /admin. With no ADMIN_PASSWORD the console does
 * not exist (404). /admin/login is public (the page itself sends a signed-in
 * admin on); /admin/logout clears the session. Everything else needs a
 * validly signed admin session; protected layouts and server actions
 * re-check the account and the credential version in the database.
 */
export async function middleware(request: NextRequest): Promise<Response> {
  const { pathname, search } = request.nextUrl;
  const secure = request.nextUrl.protocol === 'https:';

  const env = getServerEnv();
  if (env.ADMIN_PASSWORD.length === 0) {
    return new Response('Not found', {
      status: 404,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  if (pathname === '/admin/logout') {
    const response = NextResponse.redirect(
      adminRedirectUrl(request, '/admin/login'),
    );
    const cleared = clearAdminSessionCookie({ secure });
    response.cookies.set(cleared.name, cleared.value, cleared.options);
    return adminHeaders(response);
  }
  if (pathname === '/admin/login') {
    return adminHeaders(NextResponse.next());
  }

  const session = await verifyAdminSessionToken({
    token: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    secret: env.API_KEY_HASH_SECRET,
  });
  if (!session.ok) {
    // A server action answers for itself ("your session has ended"); a
    // redirect would surface as an unexpected-response error in the client.
    if (
      request.method === 'POST' &&
      request.headers.has(SERVER_ACTION_HEADER)
    ) {
      return adminHeaders(NextResponse.next());
    }
    const loginUrl = adminRedirectUrl(request, '/admin/login');
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return adminHeaders(NextResponse.redirect(loginUrl));
  }
  return adminHeaders(NextResponse.next());
}
