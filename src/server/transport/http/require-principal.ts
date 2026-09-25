import { getCurrentPrincipal } from '@/server/infrastructure/auth/current-principal';
import type { DashboardSessionClaims } from '@/server/infrastructure/auth/dashboard-session';
import { ApiError } from '@/server/transport/http/api-error';

/** Reads the dashboard session cookie or throws 401. Route handlers only. */
export async function requirePrincipal(): Promise<DashboardSessionClaims> {
  const principal = await getCurrentPrincipal();
  if (principal === null) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: 'Sign in required.',
      status: 401,
    });
  }
  return principal;
}
