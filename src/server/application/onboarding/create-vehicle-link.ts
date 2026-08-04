import { eq } from 'drizzle-orm';

import { ensureWalletForAddress } from '@/server/application/onboarding/ensure-wallet';
import { getServerEnv } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { pendingDeviceConnections } from '@/server/infrastructure/db/schema';
import {
  createHttpEnodeVehicleClient,
  ENODE_DEFAULT_VEHICLE_LINK_SCOPES,
} from '@/server/infrastructure/enode/http-client';
import {
  appendQueryParam,
  buildEnodeLinkTokenUrl,
  getEnodeRedirectUri,
  normalizeBrand,
} from '@/server/infrastructure/enode/redirect';
import {
  encodeEnodeUserId,
  linkEnvironmentFromAppEnv,
} from '@/server/infrastructure/enode/user-id';

export type CreateVehicleLinkResult =
  | {
      supported: true;
      provider: 'enode';
      linkUrl: string;
      pendingConnectionId: string;
      deviceType: 'electric_vehicle';
      brand: string;
      normalizedBrand: string;
      expiresAt: string;
      walletId: string;
    }
  | {
      supported: false;
      reason: string;
      message?: string;
    };

export async function createVehicleLink(
  db: Database,
  input: {
    walletAddress: string;
    brand?: string;
    vendor?: string;
    frontendUrl?: string;
    redirectUri?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<CreateVehicleLinkResult> {
  const env = getServerEnv();
  if (input.walletAddress.trim().length === 0) {
    return { supported: false, reason: 'WALLET_ADDRESS_REQUIRED' };
  }
  if (
    env.ENODE_CLIENT_ID === undefined ||
    env.ENODE_CLIENT_ID.length === 0 ||
    env.ENODE_API_BASE_URL === undefined ||
    env.ENODE_API_BASE_URL.length === 0
  ) {
    return { supported: false, reason: 'PROVIDER_UNAVAILABLE' };
  }

  const wallet = await ensureWalletForAddress(db, input.walletAddress);
  const brand = (input.brand ?? input.vendor ?? 'UNKNOWN').trim();
  const normalized = normalizeBrand(brand);
  const environment = linkEnvironmentFromAppEnv(env.APP_ENV);
  const enodeUserId = encodeEnodeUserId(environment, wallet.address);
  const expiresAt = new Date(
    Date.now() + env.PENDING_DEVICE_OAUTH_TTL_HOURS * 60 * 60 * 1000,
  );

  const [pending] = await db
    .insert(pendingDeviceConnections)
    .values({
      walletAddress: wallet.address,
      normalizedWalletAddress: wallet.normalizedAddress,
      walletId: wallet.walletId,
      environment,
      deviceType: 'electric_vehicle',
      brand,
      normalizedBrand: normalized,
      provider: 'enode',
      providerVendorId: input.vendor?.trim() || input.brand?.trim() || null,
      status: 'pending_oauth',
      expiresAt,
      requestMetadata: input.metadata ?? null,
    })
    .returning();

  if (pending === undefined) {
    return {
      supported: false,
      reason: 'PROVIDER_LINK_CREATION_FAILED',
      message: 'Failed to create pending connection',
    };
  }

  const baseRedirect =
    input.redirectUri?.trim() ||
    (input.frontendUrl !== undefined && input.frontendUrl.length > 0
      ? `${input.frontendUrl.replace(/\/$/, '')}/enode/complete`
      : getEnodeRedirectUri());
  const redirectWithPending = appendQueryParam(
    baseRedirect,
    'ovppPending',
    pending.id,
  );

  const client = createHttpEnodeVehicleClient(db);
  const createWithScopes = (scopes: string[]) =>
    client.createLinkSession({
      userId: enodeUserId,
      vendorType: 'vehicle',
      scopes,
      redirectUri: redirectWithPending,
      ...(input.vendor?.trim() || input.brand?.trim()
        ? { vendor: (input.vendor?.trim() || input.brand?.trim()) as string }
        : {}),
    });

  try {
    let linkSession;
    try {
      linkSession = await createWithScopes([
        ...ENODE_DEFAULT_VEHICLE_LINK_SCOPES,
      ]);
    } catch (scopeErr: unknown) {
      const err = scopeErr as { statusCode?: number; message?: string };
      const haystack = `${err.message ?? ''}`.toLowerCase();
      const isScopeRejection =
        (err.statusCode === 400 || err.statusCode === 403) &&
        (haystack.includes('scope') ||
          haystack.includes('not enabled') ||
          haystack.includes('permission'));
      if (isScopeRejection) {
        linkSession = await createWithScopes(['vehicle:read:data']);
      } else {
        throw scopeErr;
      }
    }

    const linkUrl =
      linkSession.linkUrl ??
      (linkSession.linkToken.length > 0
        ? buildEnodeLinkTokenUrl(linkSession.linkToken)
        : '');

    if (linkUrl.length === 0) {
      throw new Error('No link URL from Enode');
    }

    await db
      .update(pendingDeviceConnections)
      .set({ linkUrl, updatedAt: new Date() })
      .where(eq(pendingDeviceConnections.id, pending.id));

    return {
      supported: true,
      provider: 'enode',
      linkUrl,
      pendingConnectionId: pending.id,
      deviceType: 'electric_vehicle',
      brand,
      normalizedBrand: normalized,
      expiresAt: expiresAt.toISOString(),
      walletId: wallet.walletId,
    };
  } catch (e) {
    await db
      .update(pendingDeviceConnections)
      .set({
        status: 'failed',
        error: {
          message: e instanceof Error ? e.message : 'link failed',
        },
        updatedAt: new Date(),
      })
      .where(eq(pendingDeviceConnections.id, pending.id));

    return {
      supported: false,
      reason: 'PROVIDER_LINK_CREATION_FAILED',
      message: e instanceof Error ? e.message : 'link failed',
    };
  }
}
