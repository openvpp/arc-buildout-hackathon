import { and, eq, gt } from 'drizzle-orm';

import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { enodeApiTokens } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

import { getEnodeRedirectUri } from './redirect';

const log = createServerLogger({ component: 'enode-http-client' });

export const ENODE_CLIENT_CREDENTIALS_TOKEN_KEY = 'enode_client_credentials';

export const ENODE_DEFAULT_VEHICLE_LINK_SCOPES = [
  'vehicle:read:data',
  'vehicle:control:charging',
] as const;

export type EnodeLinkSession = {
  linkToken: string;
  linkUrl?: string;
};

/**
 * HTTP Enode API client for vehicle Link onboarding.
 * Replaces the fail-closed stub when credentials are configured.
 */
export function createHttpEnodeVehicleClient(db: Database) {
  const env = getServerEnv();
  const apiUrl = (env.ENODE_API_BASE_URL ?? '').replace(/\/$/, '');
  const oauthTokenUrl = (
    env.ENODE_OAUTH_TOKEN_URL ?? 'https://oauth.sandbox.enode.io/oauth2/token'
  ).replace(/\/$/, '');
  const clientId = env.ENODE_CLIENT_ID ?? '';
  const clientSecret = env.ENODE_CLIENT_SECRET ?? '';
  const apiVersion = env.ENODE_API_VERSION ?? '2024-10-01';

  async function enodeFetch(
    url: string,
    init: RequestInit = {},
    opts: { timeoutMs?: number; retries?: number } = {},
  ): Promise<Response> {
    const { timeoutMs = 12_000, retries = 2 } = opts;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < retries
        ) {
          await new Promise((r) => {
            setTimeout(r, 250 * 2 ** attempt);
          });
          continue;
        }
        return response;
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        if (attempt < retries) {
          await new Promise((r) => {
            setTimeout(r, 250 * 2 ** attempt);
          });
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`enodeFetch failed: ${url}`);
  }

  async function getNewAccessToken(): Promise<string> {
    if (clientId.length === 0 || clientSecret.length === 0) {
      throw new Error('Set ENODE_CLIENT_ID and ENODE_CLIENT_SECRET.');
    }
    const credentials = Buffer.from(
      `${clientId.trim()}:${clientSecret.trim()}`,
    ).toString('base64');

    const response = await enodeFetch(oauthTokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    });

    if (!response.ok) {
      const errorData: unknown = await response.json().catch(() => ({}));
      const message =
        typeof errorData === 'object' &&
        errorData !== null &&
        'message' in errorData &&
        typeof errorData.message === 'string'
          ? errorData.message
          : `Token request failed: ${response.statusText}`;
      throw new Error(message);
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresAt = new Date(
      Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    );

    await db
      .insert(enodeApiTokens)
      .values({
        tokenKey: ENODE_CLIENT_CREDENTIALS_TOKEN_KEY,
        accessToken: tokenData.access_token,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [enodeApiTokens.tokenKey],
        set: {
          accessToken: tokenData.access_token,
          expiresAt,
          updatedAt: new Date(),
        },
      });

    return tokenData.access_token;
  }

  async function getAccessToken(): Promise<string> {
    const [row] = await db
      .select()
      .from(enodeApiTokens)
      .where(
        and(
          eq(enodeApiTokens.tokenKey, ENODE_CLIENT_CREDENTIALS_TOKEN_KEY),
          gt(enodeApiTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (row !== undefined) {
      return row.accessToken;
    }
    return getNewAccessToken();
  }

  function resourceHeaders(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Enode-Version': apiVersion,
    };
  }

  return {
    async createLinkSession(input: {
      userId: string;
      vendorType?: string;
      vendor?: string;
      scopes?: string[];
      language?: string;
      redirectUri?: string;
    }): Promise<EnodeLinkSession> {
      if (apiUrl.length === 0) {
        throw new Error('ENODE_API_BASE_URL is required for Link sessions');
      }
      const url = `${apiUrl}/users/${encodeURIComponent(input.userId)}/link`;
      const body: Record<string, unknown> = {
        vendorType: input.vendorType ?? 'vehicle',
        scopes: input.scopes ?? [...ENODE_DEFAULT_VEHICLE_LINK_SCOPES],
        language: input.language ?? 'en-US',
        redirectUri: input.redirectUri ?? getEnodeRedirectUri(),
      };
      if (input.vendor !== undefined && input.vendor.trim().length > 0) {
        body['vendor'] = input.vendor.trim();
      }

      const postLink = (bearer: string) =>
        enodeFetch(url, {
          method: 'POST',
          headers: resourceHeaders(bearer),
          body: JSON.stringify(body),
        });

      let accessToken = await getAccessToken();
      let response = await postLink(accessToken);
      if (response.status === 401) {
        await db
          .delete(enodeApiTokens)
          .where(
            eq(enodeApiTokens.tokenKey, ENODE_CLIENT_CREDENTIALS_TOKEN_KEY),
          );
        accessToken = await getNewAccessToken();
        response = await postLink(accessToken);
      }

      if (!response.ok) {
        const errorData: unknown = await response.json().catch(() => ({}));
        log.warn('enode.link_session_failed', { status: response.status });
        const err = new Error(
          `Failed to create Enode link session: ${response.status}`,
        ) as Error & { statusCode?: number; enodeError?: unknown };
        err.statusCode = response.status;
        err.enodeError = errorData;
        throw err;
      }

      return (await response.json()) as EnodeLinkSession;
    },

    async getUserVehicles(userId: string): Promise<unknown[]> {
      if (apiUrl.length === 0) {
        throw new Error('ENODE_API_BASE_URL is required');
      }
      const accessToken = await getAccessToken();
      const headers = resourceHeaders(accessToken);
      const base = `${apiUrl}/users/${encodeURIComponent(userId)}/vehicles`;
      const out: unknown[] = [];
      let after: string | undefined;
      let guard = 0;
      do {
        const url =
          after === undefined
            ? base
            : `${base}?after=${encodeURIComponent(after)}`;
        const response = await enodeFetch(url, { method: 'GET', headers });
        if (!response.ok) {
          throw new Error(`Failed to list Enode vehicles: ${response.status}`);
        }
        const data: unknown = await response.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            out.push(item);
          }
          break;
        }
        if (typeof data === 'object' && data !== null) {
          const record = data as Record<string, unknown>;
          const pageCandidate = [record['data'], record['vehicles']].find(
            (value): value is unknown[] => Array.isArray(value),
          );
          if (pageCandidate !== undefined) {
            for (const item of pageCandidate) {
              out.push(item);
            }
          }
          const pagination = record['pagination'];
          after =
            typeof pagination === 'object' &&
            pagination !== null &&
            'after' in pagination &&
            typeof pagination.after === 'string'
              ? pagination.after
              : undefined;
        } else {
          after = undefined;
        }
      } while (after !== undefined && ++guard < 50);
      return out;
    },

    async getUserVehicleById(
      _userId: string,
      vehicleId: string,
    ): Promise<Record<string, unknown> | null> {
      if (apiUrl.length === 0) {
        throw new Error('ENODE_API_BASE_URL is required');
      }
      const trimmed = vehicleId.trim();
      if (trimmed.length === 0) {
        return null;
      }
      const accessToken = await getAccessToken();
      const url = `${apiUrl}/vehicles/${encodeURIComponent(trimmed)}`;
      const response = await enodeFetch(url, {
        method: 'GET',
        headers: resourceHeaders(accessToken),
      });
      if (!response.ok) {
        return null;
      }
      const raw: unknown = await response.json().catch(() => null);
      if (raw === null || typeof raw !== 'object') {
        return null;
      }
      const o = raw as Record<string, unknown>;
      const inner =
        o['data'] !== undefined && typeof o['data'] === 'object'
          ? (o['data'] as Record<string, unknown>)
          : o;
      if (typeof inner['id'] !== 'string' && typeof inner['id'] !== 'number') {
        return null;
      }
      return inner;
    },
  };
}

export type HttpEnodeVehicleClient = ReturnType<
  typeof createHttpEnodeVehicleClient
>;
