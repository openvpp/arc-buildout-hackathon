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
      new URL('/admin/login', request.url),
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
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return adminHeaders(NextResponse.redirect(loginUrl));
  }
  return adminHeaders(NextResponse.next());
}
