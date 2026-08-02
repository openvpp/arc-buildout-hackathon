import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { API_SCOPES } from '@/server/config/constants';

export type ApiScope = (typeof API_SCOPES)[number];

export type AuthenticatedPrincipal = {
  readonly principalId: string;
  readonly principalType: string;
  readonly credentialId: string;
  readonly scopes: readonly string[];
  readonly keyPrefix: string;
};

export type CreatedApiCredential = {
  readonly id: string;
  readonly principalId: string;
  readonly keyPrefix: string;
  /** Complete credential — returned exactly once at creation time. */
  readonly secret: string;
  readonly scopes: readonly string[];
  readonly expiresAt: Date | null;
};

const KEY_PREFIX = 'evt_';

export function generateApiKeyMaterial(): {
  secret: string;
  keyPrefix: string;
} {
  const raw = randomBytes(32).toString('base64url');
  const secret = `${KEY_PREFIX}${raw}`;
  const keyPrefix = secret.slice(0, 12);
  return { secret, keyPrefix };
}

export function hashApiKey(secret: string, hashSecret: string): string {
  return createHmac('sha256', hashSecret).update(secret).digest('hex');
}

export function apiKeysEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function credentialHasScope(
  scopes: readonly string[],
  required: ApiScope,
): boolean {
  return scopes.includes(required) || scopes.includes('admin:manage');
}
