import { and, eq, isNull, or, gt } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import { ApiError } from '@/server/transport/http/api-error';

import {
  type AuthenticatedPrincipal,
  hashApiKey,
  apiKeysEqual,
} from './api-keys';
import type { Database } from '../db/client';
import { apiCredentials, principals } from '../db/schema';

export type AuthService = {
  authenticateApiKey(apiKey: string | null): Promise<AuthenticatedPrincipal>;
};

export function createAuthService(db: Database): AuthService {
  return {
    async authenticateApiKey(
      apiKey: string | null,
    ): Promise<AuthenticatedPrincipal> {
      if (apiKey === null || apiKey.trim().length === 0) {
        throw new ApiError({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'API key is required.',
          status: 401,
        });
      }

      const env = getServerEnv();
      const keyHash = hashApiKey(apiKey.trim(), env.API_KEY_HASH_SECRET);
      const keyPrefix = apiKey.trim().slice(0, 12);

      const rows = await db
        .select({
          credentialId: apiCredentials.id,
          principalId: apiCredentials.principalId,
          keyHash: apiCredentials.keyHash,
          keyPrefix: apiCredentials.keyPrefix,
          scopes: apiCredentials.scopes,
          status: apiCredentials.status,
          expiresAt: apiCredentials.expiresAt,
          principalType: principals.type,
          principalStatus: principals.status,
        })
        .from(apiCredentials)
        .innerJoin(principals, eq(principals.id, apiCredentials.principalId))
        .where(
          and(
            eq(apiCredentials.keyPrefix, keyPrefix),
            eq(apiCredentials.status, 'active'),
            or(
              isNull(apiCredentials.expiresAt),
              gt(apiCredentials.expiresAt, new Date()),
            ),
          ),
        )
        .limit(5);

      const match = rows.find((row) => apiKeysEqual(row.keyHash, keyHash));

      if (
        match === undefined ||
        match.principalStatus !== 'active' ||
        match.status !== 'active'
      ) {
        throw new ApiError({
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Invalid or revoked API key.',
          status: 401,
        });
      }

      // Best-effort last-used update; do not fail the request if it races.
      await db
        .update(apiCredentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiCredentials.id, match.credentialId));

      return {
        principalId: match.principalId,
        principalType: match.principalType,
        credentialId: match.credentialId,
        scopes: match.scopes,
        keyPrefix: match.keyPrefix,
      };
    },
  };
}
