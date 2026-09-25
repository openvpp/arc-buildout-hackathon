import { eq } from 'drizzle-orm';

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
import { encodeEnodeUserId } from '@/server/infrastructure/enode/user-id';

export type CreateVehicleLinkResult =
  | {
      supported: true;
      linkUrl: string;
      pendingConnectionId: string;
      expiresAt: string;
    }
  | { supported: false; reason: string; message?: string };

/**
 * Start an Enode Link session for the caller's wallet. `walletId`/
 * `walletAddress` come from the verified dashboard session, never from the
 * request body.
 */
export async function createVehicleLink(
  db: Database,
  input: {
    walletId: string;
    walletAddress: string;
    normalizedWalletAddress: string;
    brand?: string;
  },
): Promise<CreateVehicleLinkResult> {
  const env = getServerEnv();
  if (
    env.ENODE_CLIENT_ID === undefined ||
    env.ENODE_CLIENT_ID.length === 0 ||
    env.ENODE_API_BASE_URL === undefined ||
    env.ENODE_API_BASE_URL.length === 0
  ) {
    return { supported: false, reason: 'PROVIDER_UNAVAILABLE' };
  }

  const brand = (input.brand ?? 'UNKNOWN').trim();
  const normalizedBrand = normalizeBrand(brand);
  const enodeUserId = encodeEnodeUserId(input.walletId);
  const expiresAt = new Date(
    Date.now() + env.PENDING_DEVICE_OAUTH_TTL_HOURS * 60 * 60 * 1000,
  );

  const [pending] = await db
    .insert(pendingDeviceConnections)
    .values({
      walletId: input.walletId,
      walletAddress: input.walletAddress,
      normalizedWalletAddress: input.normalizedWalletAddress,
      brand,
      normalizedBrand,
      provider: 'enode',
      status: 'pending_oauth',
      expiresAt,
    })
    .returning();
  if (pending === undefined) {
    return { supported: false, reason: 'PROVIDER_LINK_CREATION_FAILED' };
  }

  const redirectWithPending = appendQueryParam(
    getEnodeRedirectUri(),
    'pendingId',
    pending.id,
  );
  const client = createHttpEnodeVehicleClient();

  try {
    const linkSession = await client.createLinkSession({
      userId: enodeUserId,
      vendorType: 'vehicle',
      scopes: [...ENODE_DEFAULT_VEHICLE_LINK_SCOPES],
      redirectUri: redirectWithPending,
      ...(brand !== 'UNKNOWN' ? { vendor: brand } : {}),
    });
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
      linkUrl,
      pendingConnectionId: pending.id,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (e) {
    await db
      .update(pendingDeviceConnections)
      .set({
        status: 'failed',
        error: { message: e instanceof Error ? e.message : 'link failed' },
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
