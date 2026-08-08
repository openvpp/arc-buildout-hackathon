import { z } from 'zod';

import { bindDashboardOwnerWallet } from '@/server/application/onboarding/bind-dashboard-owner';
import { getContainer } from '@/server/bootstrap/container';
import { getServerEnv } from '@/server/config/env';
import {
  buildDashboardSessionCookie,
  clearDashboardSessionCookie,
  createDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';
import { verifyWeb3AuthIdentity } from '@/server/infrastructure/auth/web3auth-identity';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    /** Optional hint only — identity wallet is taken from the verified JWT. */
    walletAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .optional(),
  })
  .strict();

function cookieSecureFlag(): boolean {
  const env = getServerEnv();
  return env.APP_ENV === 'production' || env.APP_ENV === 'staging';
}

/**
 * Establish an httpOnly dashboard session for RSC loaders after Web3Auth login.
 * Auth: Bearer idToken. Wallet comes from the JWT wallets claim.
 */
export const POST = createRouteHandler(async (request, context) => {
  let body: unknown = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new ApiError({
        code: 'VALIDATION_FAILED',
        message: 'Invalid dashboard session request body.',
        status: 400,
      });
    }
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid dashboard session request.',
      status: 400,
      details: { issues: parsed.error.issues },
    });
  }

  const identity = await verifyWeb3AuthIdentity({
    authorizationHeader: request.headers.get('authorization'),
    claimedWalletAddress: parsed.data.walletAddress ?? null,
  });

  const container = getContainer();
  const bound = await bindDashboardOwnerWallet(container.db, identity);
  const env = getServerEnv();
  const token = await createDashboardSessionToken({
    principalId: bound.principalId,
    subject: bound.subject,
    walletAddress: bound.normalizedAddress,
    secret: env.API_KEY_HASH_SECRET,
  });
  const cookie = buildDashboardSessionCookie({
    token,
    secure: cookieSecureFlag(),
  });

  const response = jsonOk(
    {
      principalId: bound.principalId,
      walletId: bound.walletId,
      walletAddress: bound.normalizedAddress,
    },
    context.requestId,
  );
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});

/** Clear the owner dashboard session cookie (wallet disconnect). */
export const DELETE = createRouteHandler(async (_request, context) => {
  const cookie = clearDashboardSessionCookie({ secure: cookieSecureFlag() });
  const response = jsonOk({ ok: true as const }, context.requestId);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});
