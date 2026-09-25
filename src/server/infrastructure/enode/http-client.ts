import { getServerEnv } from '@/server/config/env';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'enode-http-client' });

export const ENODE_DEFAULT_VEHICLE_LINK_SCOPES = [
  'vehicle:read:data',
  'vehicle:read:location',
  'vehicle:control:charging',
];

export type EnodeLinkSession = {
  linkUrl?: string;
  linkToken: string;
};

export type EnodeHttpError = Error & { statusCode?: number };

let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function requireEnodeConfig() {
  const env = getServerEnv();
  if (
    env.ENODE_API_BASE_URL === undefined ||
    env.ENODE_API_BASE_URL.length === 0 ||
    env.ENODE_OAUTH_TOKEN_URL === undefined ||
    env.ENODE_OAUTH_TOKEN_URL.length === 0 ||
    env.ENODE_CLIENT_ID === undefined ||
    env.ENODE_CLIENT_ID.length === 0 ||
    env.ENODE_CLIENT_SECRET === undefined ||
    env.ENODE_CLIENT_SECRET.length === 0
  ) {
    throw new Error('Enode is not configured.');
  }
  return {
    apiBaseUrl: env.ENODE_API_BASE_URL,
    tokenUrl: env.ENODE_OAUTH_TOKEN_URL,
    clientId: env.ENODE_CLIENT_ID,
    clientSecret: env.ENODE_CLIENT_SECRET,
    apiVersion: env.ENODE_API_VERSION,
  };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken !== null && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.accessToken;
  }
  const config = requireEnodeConfig();
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) {
    const error: EnodeHttpError = new Error(
      `Enode token request failed (${response.status})`,
    );
    error.statusCode = response.status;
    throw error;
  }
  const body = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    accessToken: body.access_token,
    expiresAt: now + body.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

async function enodeFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const config = requireEnodeConfig();
  const token = await getAccessToken();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(config.apiVersion !== undefined
        ? { 'Enode-Version': config.apiVersion }
        : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error: EnodeHttpError = new Error(
      `Enode request failed (${response.status}): ${text.slice(0, 300)}`,
    );
    error.statusCode = response.status;
    log.warn('enode.request_failed', { path, statusCode: response.status });
    throw error;
  }
  return (await response.json()) as T;
}

export type EnodeVehicleClient = {
  createLinkSession(input: {
    userId: string;
    vendorType: string;
    scopes: string[];
    redirectUri: string;
    vendor?: string;
  }): Promise<EnodeLinkSession>;
  getUserVehicles(userId: string): Promise<unknown[]>;
  getUserVehicleById(userId: string, vehicleId: string): Promise<unknown>;
};

/** Server-to-server Enode client (client-credentials). Server-only. */
export function createHttpEnodeVehicleClient(): EnodeVehicleClient {
  return {
    async createLinkSession(input) {
      return enodeFetch<EnodeLinkSession>(`/users/${input.userId}/link`, {
        method: 'POST',
        body: {
          vendorType: input.vendorType,
          scopes: input.scopes,
          redirectUri: input.redirectUri,
          ...(input.vendor !== undefined ? { vendor: input.vendor } : {}),
        },
      });
    },
    async getUserVehicles(userId) {
      const result = await enodeFetch<{ data: unknown[] }>(
        `/users/${userId}/vehicles`,
      );
      return result.data;
    },
    async getUserVehicleById(userId, vehicleId) {
      return enodeFetch<unknown>(`/users/${userId}/vehicles/${vehicleId}`);
    },
  };
}
