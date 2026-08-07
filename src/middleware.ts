import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getAdminBasicCredentials, getServerEnv } from '@/server/config/env';
import { adminNotConfiguredResponse } from '@/server/infrastructure/auth/admin-basic-auth';
import {
  ADMIN_SESSION_COOKIE,
  clearAdminSessionCookie,
  verifyAdminSessionToken,
} from '@/server/infrastructure/auth/admin-session';

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

function isSecureRequest(request: NextRequest): boolean {
  return request.nextUrl.protocol === 'https:';
}

/**
 * Cookie session gate for /admin. Public: /admin/login. Logout clears the
 * session cookie. All other /admin routes require a valid signed session.
 */
export async function middleware(request: NextRequest): Promise<Response> {
  const { pathname } = request.nextUrl;
  const credentials = getAdminBasicCredentials();
  const secure = isSecureRequest(request);

  if (pathname === '/admin/logout') {
    const response = NextResponse.redirect(
      new URL('/admin/login', request.url),
    );
    const cleared = clearAdminSessionCookie({ secure });
    response.cookies.set(cleared.name, cleared.value, cleared.options);
    return response;
  }

  if (credentials === null) {
    if (pathname === '/admin/login') {
      return NextResponse.next();
    }
    return adminNotConfiguredResponse();
  }

  const env = getServerEnv();
  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const session = await verifyAdminSessionToken({
    token,
    secret: env.API_KEY_HASH_SECRET,
  });

  if (pathname === '/admin/login') {
    if (session.ok) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }
    return NextResponse.next();
  }

  if (!session.ok) {
    const loginUrl = new URL('/admin/login', request.url);
    if (pathname !== '/admin') {
      loginUrl.searchParams.set('next', pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
