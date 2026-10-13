import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  PASSWORD_MAX_LENGTH,
  registerWithPassword,
  signInWithPassword,
} from '@/server/application/onboarding/password-sign-in';
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

const googleBodySchema = z
  .object({
    idToken: z.string().trim().min(1).max(8192),
  })
  .strict();

const passwordBodySchema = z
  .object({
    email: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    intent: z.enum(['register', 'login']),
  })
  .strict();

const bodySchema = z.union([googleBodySchema, passwordBodySchema]);

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
 * controlled wallet flow. Google sends an ID token. Password sign-in sends
 * an email plus password; the email is only the account key, and the
 * password hash is checked before any wallet is opened. A wallet address
 * is never accepted.
 */
export const POST = createRouteHandler(async (request, context) => {
  enforceRateLimit({
    request,
    bucket: 'session',
    limit: 15,
    windowMs: SESSION_WINDOW_MS,
  });
  const parsed = bodySchema.parse(await readJsonBody(request));
  if ('idToken' in parsed) {
    enforceRateLimit({
      request,
      bucket: 'session-google',
      limit: 8,
      windowMs: SESSION_WINDOW_MS,
      scope: 'global',
      keySuffix: createHash('sha256').update(parsed.idToken).digest('hex'),
    });
  } else {
    enforceRateLimit({
      request,
      bucket: 'session-password',
      limit: 8,
      windowMs: SESSION_WINDOW_MS,
      scope: 'global',
      keySuffix: createHash('sha256')
        .update(parsed.email.trim().toLowerCase())
        .digest('hex'),
    });
  }

  const db = getDb();
  const bound =
    'idToken' in parsed
      ? await signInWithGoogle(db, { idToken: parsed.idToken })
      : parsed.intent === 'register'
        ? await registerWithPassword(db, {
            email: parsed.email,
            password: parsed.password,
          })
        : await signInWithPassword(db, {
            email: parsed.email,
            password: parsed.password,
          });

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
