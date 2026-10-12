/**
 * @vitest-environment node
 */
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import { describe, expect, it } from 'vitest';

import {
  emailFromGoogleIdToken,
  GoogleIdTokenError,
} from '@/server/infrastructure/google/verify-google-id-token';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

async function verifier(): Promise<{
  audience: string;
  getKey: JWTVerifyGetKey;
  sign: (claims: Record<string, unknown>, audience?: string) => Promise<string>;
}> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const getKey = createLocalJWKSet({ keys: [jwk] });
  return {
    audience: CLIENT_ID,
    getKey,
    sign: (claims, audience = CLIENT_ID) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer('https://accounts.google.com')
        .setAudience(audience)
        .setSubject('google-user')
        .setExpirationTime('2m')
        .sign(privateKey),
  };
}

describe('emailFromGoogleIdToken', () => {
  it('returns the verified email when the token is for this client', async () => {
    const google = await verifier();
    const idToken = await google.sign({
      email: 'Ada@Example.com',
      email_verified: true,
    });
    await expect(
      emailFromGoogleIdToken(idToken, {
        audience: google.audience,
        getKey: google.getKey,
      }),
    ).resolves.toBe('ada@example.com');
  });

  it('rejects a token issued for a different client', async () => {
    const google = await verifier();
    const idToken = await google.sign(
      { email: 'ada@example.com', email_verified: true },
      'other-client.apps.googleusercontent.com',
    );
    await expect(
      emailFromGoogleIdToken(idToken, {
        audience: google.audience,
        getKey: google.getKey,
      }),
    ).rejects.toMatchObject({ reason: 'rejected' });
  });

  it('rejects an unverified email and a missing Google client id', async () => {
    const google = await verifier();
    const idToken = await google.sign({
      email: 'ada@example.com',
      email_verified: false,
    });
    await expect(
      emailFromGoogleIdToken(idToken, {
        audience: google.audience,
        getKey: google.getKey,
      }),
    ).rejects.toBeInstanceOf(GoogleIdTokenError);
    await expect(
      emailFromGoogleIdToken(idToken, {
        audience: '',
        getKey: google.getKey,
      }),
    ).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
