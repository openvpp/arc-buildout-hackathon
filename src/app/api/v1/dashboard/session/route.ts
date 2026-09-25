import { z } from 'zod';

import { bindDashboardOwner } from '@/server/application/onboarding/bind-dashboard-owner';
import { getServerEnv } from '@/server/config/env';
import {
  buildDashboardSessionCookie,
  clearDashboardSessionCookie,
  createDashboardSessionToken,
} from '@/server/infrastructure/auth/dashboard-session';
import { verifyGoogleIdentity } from '@/server/infrastructure/auth/google-identity';
import { getDb } from '@/server/infrastructure/db/client';
import { ApiError } from '@/server/transport/http/api-error';
import { jsonOk } from '@/server/transport/http/api-response';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    googleIdToken: z.string().min(1),
  })
  .strict();

function cookieSecureFlag(): boolean {
  const env = getServerEnv();
  return env.APP_ENV === 'production' || env.APP_ENV === 'staging';
}

/**
 * Establish the httpOnly dashboard session after Circle developer-controlled
 * wallet registration/login. Auth proof: a Google id_token, verified
 * server-side. The Circle wallet is created/found server-side; its address
 * never comes from the request body.
 */
export const POST = createRouteHandler(async (request, context) => {
  const text = await request.text();
  let body: unknown;
  try {
    body = text.trim().length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new ApiError({
      code: 'VALIDATION_FAILED',
      message: 'Invalid session request body.',
      status: 400,
    });
  }
  const parsed = bodySchema.parse(body);

  const identity = await verifyGoogleIdentity({
    idToken: parsed.googleIdToken,
  });
  const db = getDb();
  const bound = await bindDashboardOwner(db, identity);

  const env = getServerEnv();
  const token = await createDashboardSessionToken({
    principalId: bound.principalId,
    subject: bound.subject,
    walletId: bound.walletId,
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

export const DELETE = createRouteHandler(async (_request, context) => {
  const cookie = clearDashboardSessionCookie({ secure: cookieSecureFlag() });
  const response = jsonOk({ ok: true as const }, context.requestId);
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});
