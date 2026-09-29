import { z } from 'zod';

import { bindDashboardOwner } from '@/server/application/onboarding/bind-dashboard-owner';
import { getServerEnv } from '@/server/config/env';
import {
  buildDashboardSessionCookie,
  clearDashboardSessionCookie,
  createDashboardSessionToken,
  isSecureSessionCookie,
} from '@/server/infrastructure/auth/dashboard-session';
import { getDb } from '@/server/infrastructure/db/client';
import { jsonOk } from '@/server/transport/http/api-response';
import { enforceRateLimit } from '@/server/transport/http/rate-limit';
import { readJsonBody } from '@/server/transport/http/read-body';
import { createRouteHandler } from '@/server/transport/http/route-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z
  .object({
    email: z.string().trim().email().max(254),
  })
  .strict();

const SESSION_WINDOW_MS = 10 * 60 * 1000;

function cookieSecureFlag(): boolean {
  const env = getServerEnv();
  return isSecureSessionCookie({
    appEnv: env.APP_ENV,
    nodeEnv: process.env.NODE_ENV,
  });
}

/**
 * Establish the httpOnly dashboard session for the Circle developer-
 * controlled wallet flow. Identity is the email the caller typed — see the
 * comment on bindDashboardOwner for why this is intentionally unverified.
 * The Circle wallet itself is always created/found server-side; its
 * address never comes from the request body.
 */
export const POST = createRouteHandler(async (request, context) => {
  enforceRateLimit({
    request,
    bucket: 'session',
    limit: 15,
    windowMs: SESSION_WINDOW_MS,
  });
  const parsed = bodySchema.parse(await readJsonBody(request));
  enforceRateLimit({
    request,
    bucket: 'session-email',
    limit: 8,
    windowMs: SESSION_WINDOW_MS,
    scope: 'global',
    keySuffix: parsed.email.toLowerCase(),
  });

  const db = getDb();
  const bound = await bindDashboardOwner(db, { email: parsed.email });

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
