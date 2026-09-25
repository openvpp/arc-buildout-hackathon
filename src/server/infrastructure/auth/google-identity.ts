import { OAuth2Client } from 'google-auth-library';

import { getServerEnv } from '@/server/config/env';
import { ApiError } from '@/server/transport/http/api-error';

export type VerifiedGoogleIdentity = {
  readonly subject: string;
  readonly email: string;
};

let cachedClient: OAuth2Client | null = null;

function client(): OAuth2Client {
  if (cachedClient === null) {
    cachedClient = new OAuth2Client();
  }
  return cachedClient;
}

/**
 * Verify a Google Identity Services id_token server-side. This is the
 * registration/login proof for the Circle developer-controlled wallet: the
 * browser never holds a Circle secret, only this Google-signed token.
 */
export async function verifyGoogleIdentity(input: {
  idToken: string | null | undefined;
}): Promise<VerifiedGoogleIdentity> {
  const env = getServerEnv();
  if (
    env.GOOGLE_OAUTH_CLIENT_ID === undefined ||
    env.GOOGLE_OAUTH_CLIENT_ID.length === 0
  ) {
    throw new ApiError({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Google sign-in is not configured.',
      status: 503,
    });
  }
  if (
    input.idToken === null ||
    input.idToken === undefined ||
    input.idToken.length === 0
  ) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: 'Missing Google id_token.',
      status: 401,
    });
  }

  let payload;
  try {
    const ticket = await client().verifyIdToken({
      idToken: input.idToken,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (error) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: 'Google id_token verification failed.',
      status: 401,
      details: { reason: error instanceof Error ? error.message : 'unknown' },
    });
  }

  if (payload === undefined || payload.sub.length === 0) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: 'Google id_token has no subject.',
      status: 401,
    });
  }
  const email = payload.email?.trim().toLowerCase();
  if (
    email === undefined ||
    email.length === 0 ||
    payload.email_verified !== true
  ) {
    throw new ApiError({
      code: 'UNAUTHENTICATED',
      message: 'Google account has no verified email.',
      status: 401,
    });
  }

  return { subject: payload.sub, email };
}
