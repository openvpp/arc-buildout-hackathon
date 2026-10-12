import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { getServerEnv } from '@/server/config/env';

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export class GoogleIdTokenError extends Error {
  readonly reason: 'unavailable' | 'rejected';

  constructor(reason: 'unavailable' | 'rejected', message: string) {
    super(message);
    this.name = 'GoogleIdTokenError';
    this.reason = reason;
  }
}

export type GoogleIdTokenVerifier = {
  audience: string;
  getKey: JWTVerifyGetKey;
};

function configuredVerifier(): GoogleIdTokenVerifier {
  return {
    audience: getServerEnv().GOOGLE_OAUTH_CLIENT_ID.trim(),
    getKey: GOOGLE_JWKS,
  };
}

/**
 * Email from a Google ID token issued for this app's OAuth client.
 * The token is checked against Google's signing keys, and `aud` must be
 * our client id — a caller-supplied email is never accepted.
 */
export async function emailFromGoogleIdToken(
  idToken: string,
  verifier: GoogleIdTokenVerifier = configuredVerifier(),
): Promise<string> {
  if (verifier.audience.length === 0) {
    throw new GoogleIdTokenError(
      'unavailable',
      'Google sign-in is not configured.',
    );
  }

  let email: unknown;
  let emailVerified: unknown;
  try {
    const { payload } = await jwtVerify(idToken, verifier.getKey, {
      algorithms: ['RS256'],
      audience: verifier.audience,
      issuer: GOOGLE_ISSUERS,
    });
    email = payload.email;
    emailVerified = payload.email_verified;
  } catch (error) {
    if (error instanceof GoogleIdTokenError) {
      throw error;
    }
    throw new GoogleIdTokenError(
      'rejected',
      'Google sign-in could not be verified.',
    );
  }

  if (emailVerified !== true || typeof email !== 'string') {
    throw new GoogleIdTokenError(
      'rejected',
      'Google account has no verified email.',
    );
  }
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0 || !normalized.includes('@')) {
    throw new GoogleIdTokenError(
      'rejected',
      'Google account has no verified email.',
    );
  }
  return normalized;
}
