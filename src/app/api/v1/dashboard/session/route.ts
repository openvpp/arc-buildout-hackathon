import { createHash } from 'node:crypto';

import { z } from 'zod';

import { signInWithGoogle } from '@/server/application/onboarding/sign-in-with-google';
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
    idToken: z.string().trim().min(1).max(8192),
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
 * controlled wallet flow. The body is a Google ID token; the email and
 * wallet are resolved server-side after that token is verified for this
 * app's OAuth client. A raw email or wallet address is not accepted.
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
    bucket: 'session-google',
    limit: 8,
    windowMs: SESSION_WINDOW_MS,
    scope: 'global',
    keySuffix: createHash('sha256').update(parsed.idToken).digest('hex'),
  });

  const db = getDb();
  const bound = await signInWithGoogle(db, { idToken: parsed.idToken });

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
