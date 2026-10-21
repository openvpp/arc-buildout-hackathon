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

/**
 * Cookie-session gate for /admin. Public: /admin/login. /admin/logout clears
 * the session. Everything else needs a valid signed admin session; the
 * protected layout re-checks the account in the database.
 */
export async function middleware(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;
  const secure = request.nextUrl.protocol === 'https:';

  if (pathname === '/admin/logout') {
    const response = NextResponse.redirect(
      new URL('/admin/login', request.url),
    );
    const cleared = clearAdminSessionCookie({ secure });
    response.cookies.set(cleared.name, cleared.value, cleared.options);
    return response;
  }

  const env = getServerEnv();
  if (env.ADMIN_PASSWORD.length === 0) {
    if (pathname === '/admin/login') {
      return NextResponse.next();
    }
    return new Response('Admin is not configured on this environment.', {
      status: 503,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  }

  const session = await verifyAdminSessionToken({
    token: request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
    secret: env.API_KEY_HASH_SECRET,
  });

  if (pathname === '/admin/login') {
    return session.ok
      ? NextResponse.redirect(new URL('/admin', request.url))
      : NextResponse.next();
  }
  if (!session.ok) {
    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }
  const response = NextResponse.next();
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-robots-tag', 'noindex, nofollow');
  return response;
}
