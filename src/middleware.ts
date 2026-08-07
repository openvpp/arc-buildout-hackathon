import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getAdminBasicCredentials } from '@/server/config/env';
import {
  adminAuthFailureResponse,
  evaluateAdminBasicAuth,
} from '@/server/infrastructure/auth/admin-basic-auth';

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

/**
 * HTTP Basic Auth for /admin. Middleware can return a real 401 + WWW-Authenticate
 * challenge (required for the browser credential prompt).
 */
export function middleware(request: NextRequest): Response {
  const decision = evaluateAdminBasicAuth(
    request.headers.get('authorization'),
    getAdminBasicCredentials(),
  );
  if (!decision.ok) {
    return adminAuthFailureResponse(decision);
  }
  return NextResponse.next();
}
