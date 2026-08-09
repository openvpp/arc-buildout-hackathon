/**
 * Recover local wallets + devices from Enode Linked vehicles.
 *
 * Use when Postgres public tables were wiped but Enode sandbox still has Links.
 * Idempotent on external_device_id / wallet address.
 *
 * Prerequisites:
 *   pnpm db:migrate   # public.wallets (etc.) must exist
 *   ENODE_* + DATABASE_URL + ARC_CHAIN_ID in .env.local
 *
 * Usage:
 *   pnpm enode:import-vehicles
 *   ENODE_IMPORT_WALLET_ADDRESS=0x… pnpm enode:import-vehicles
 *   ENODE_IMPORT_EXTERNAL_DEVICE_IDS=id1,id2 pnpm enode:import-vehicles
 */
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { ARC_TESTNET_CHAIN_ID } from '../src/server/config/circle';
import { getServerEnv } from '../src/server/config/env';
import { normalizeEvmAddress } from '../src/server/infrastructure/db/repositories/wallet-repository';
import * as schema from '../src/server/infrastructure/db/schema';
import {
  devices,
  enodeConnections,
  principalWallets,
  principals,
  wallets,
} from '../src/server/infrastructure/db/schema/index';

type EnodeVehicleListItem = {
  readonly id?: unknown;
  readonly userId?: unknown;
  readonly vendor?: unknown;
  readonly isReachable?: unknown;
  readonly information?: {
    readonly displayName?: unknown;
    readonly brand?: unknown;
    readonly model?: unknown;
  };
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enode user ids that are EVM wallets (optionally prefixed with env::). */
function walletAddressFromEnodeUserId(userId: string): string | null {
  const bare = userId.includes('::')
    ? (userId.split('::').at(-1) ?? userId)
    : userId;
  if (!/^0x[a-fA-F0-9]{40}$/.test(bare)) {
    return null;
  }
  return normalizeEvmAddress(bare);
}

async function getEnodeAccessToken(env: ReturnType<typeof getServerEnv>) {
  const clientId = env.ENODE_CLIENT_ID ?? '';
  const clientSecret = env.ENODE_CLIENT_SECRET ?? '';
  const tokenUrl = (
    env.ENODE_OAUTH_TOKEN_URL ?? 'https://oauth.sandbox.enode.io/oauth2/token'
  ).replace(/\/$/, '');
  if (clientId.length === 0 || clientSecret.length === 0) {
    throw new Error('Set ENODE_CLIENT_ID and ENODE_CLIENT_SECRET');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) {
    throw new Error(`Enode token failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('Enode token response missing access_token');
  }
  return body.access_token;
}

async function listEnodeVehicles(
  env: ReturnType<typeof getServerEnv>,
  accessToken: string,
): Promise<EnodeVehicleListItem[]> {
  const apiUrl = (env.ENODE_API_BASE_URL ?? '').replace(/\/$/, '');
  const apiVersion = env.ENODE_API_VERSION ?? '2024-10-01';
  if (apiUrl.length === 0) {
    throw new Error('ENODE_API_BASE_URL is required');
  }
  const collected: EnodeVehicleListItem[] = [];
  let after: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${apiUrl}/vehicles`);
    if (after !== null) {
      url.searchParams.set('after', after);
    }
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Enode-Version': apiVersion,
      },
    });
    if (!response.ok) {
      throw new Error(`Enode GET /vehicles failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as {
      data?: EnodeVehicleListItem[];
      pagination?: { after?: string | null };
    };
    const batch = body.data ?? [];
    collected.push(...batch);
    const next = body.pagination?.after;
    if (typeof next !== 'string' || next.length === 0) {
      break;
    }
    after = next;
  }
  return collected;
}

async function main(): Promise<void> {
  const env = getServerEnv();
  const sqlClient = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(sqlClient, { schema });

  const [{ exists }] = await sqlClient<{ exists: boolean }[]>`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public' and table_name = 'wallets'
    ) as exists
  `;
  if (!exists) {
    await sqlClient.end({ timeout: 5 });
    throw new Error(
      'public.wallets is missing. Truncate drizzle.__drizzle_migrations and run pnpm db:migrate first.',
    );
  }

  const chainId = BigInt(env.ARC_CHAIN_ID ?? ARC_TESTNET_CHAIN_ID);
  const accessToken = await getEnodeAccessToken(env);
  const vehicles = await listEnodeVehicles(env, accessToken);
  console.log(`Enode returned ${vehicles.length} vehicle(s).`);

  const allowDeviceIds = new Set(
    (process.env.ENODE_IMPORT_EXTERNAL_DEVICE_IDS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  const allowWalletRaw = asNonEmptyString(
    process.env.ENODE_IMPORT_WALLET_ADDRESS,
  );
  const allowWallet =
    allowWalletRaw === null
      ? null
      : walletAddressFromEnodeUserId(allowWalletRaw);
  if (allowWalletRaw !== null && allowWallet === null) {
    throw new Error(
      `ENODE_IMPORT_WALLET_ADDRESS is not a valid EVM address: ${allowWalletRaw}`,
    );
  }
  if (allowDeviceIds.size > 0) {
    console.log(
      `Filtering to ${allowDeviceIds.size} external device id(s) from ENODE_IMPORT_EXTERNAL_DEVICE_IDS`,
    );
  }
  if (allowWallet !== null) {
    console.log(`Filtering to wallet ${allowWallet}`);
  }

  let walletsCreated = 0;
  let devicesCreated = 0;
  let devicesUpdated = 0;
  let skipped = 0;

  for (const vehicle of vehicles) {
    const externalDeviceId = asNonEmptyString(vehicle.id);
    const enodeUserId = asNonEmptyString(vehicle.userId);
    if (externalDeviceId === null || enodeUserId === null) {
      skipped += 1;
      continue;
    }
    if (allowDeviceIds.size > 0 && !allowDeviceIds.has(externalDeviceId)) {
      skipped += 1;
      continue;
    }
    const walletAddress = walletAddressFromEnodeUserId(enodeUserId);
    if (walletAddress === null) {
      console.log(
        `skip vehicle ${externalDeviceId}: userId ${enodeUserId} is not an EVM wallet`,
      );
      skipped += 1;
      continue;
    }
    if (allowWallet !== null && walletAddress !== allowWallet) {
      skipped += 1;
      continue;
    }

    const vendor = asNonEmptyString(vehicle.vendor);
    const brand = asNonEmptyString(vehicle.information?.brand);
    const model =
      asNonEmptyString(vehicle.information?.model) ??
      asNonEmptyString(vehicle.information?.brand);
    const displayName =
      asNonEmptyString(vehicle.information?.displayName) ??
      brand ??
      vendor ??
      'Enode vehicle';

    const result = await db.transaction(async (tx) => {
      const [existingWallet] = await tx
        .select({ id: wallets.id })
        .from(wallets)
        .where(
          and(
            eq(wallets.chainId, chainId),
            eq(wallets.normalizedAddress, walletAddress),
          ),
        )
        .limit(1);

      let walletId = existingWallet?.id;
      if (walletId === undefined) {
        const [created] = await tx
          .insert(wallets)
          .values({
            chainId,
            address: walletAddress,
            normalizedAddress: walletAddress,
            label: 'Imported from Enode',
          })
          .returning({ id: wallets.id });
        if (created === undefined) {
          throw new Error(`Failed to create wallet ${walletAddress}`);
        }
        walletId = created.id;
        walletsCreated += 1;
      }

      const [existingConnection] = await tx
        .select({ id: enodeConnections.id })
        .from(enodeConnections)
        .where(eq(enodeConnections.externalUserId, enodeUserId))
        .limit(1);

      let connectionId = existingConnection?.id;
      if (connectionId === undefined) {
        const [createdConnection] = await tx
          .insert(enodeConnections)
          .values({
            externalUserId: enodeUserId,
            walletId,
            status: 'connected',
            connectedAt: new Date(),
            lastSyncedAt: new Date(),
          })
          .returning({ id: enodeConnections.id });
        if (createdConnection === undefined) {
          throw new Error(`Failed to create enode_connection ${enodeUserId}`);
        }
        connectionId = createdConnection.id;
      } else {
        await tx
          .update(enodeConnections)
          .set({
            walletId,
            status: 'connected',
            lastSyncedAt: new Date(),
            disconnectedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(enodeConnections.id, connectionId));
      }

      const principalDisplayName = `enode-import:${walletAddress}`;
      const [existingPrincipal] = await tx
        .select({ id: principals.id })
        .from(principals)
        .where(
          and(
            eq(principals.type, 'dashboard_user'),
            eq(principals.displayName, principalDisplayName),
          ),
        )
        .limit(1);

      let principalId = existingPrincipal?.id;
      if (principalId === undefined) {
        const [createdPrincipal] = await tx
          .insert(principals)
          .values({
            type: 'dashboard_user',
            displayName: principalDisplayName,
            status: 'active',
          })
          .returning({ id: principals.id });
        if (createdPrincipal === undefined) {
          throw new Error(`Failed to create principal for ${walletAddress}`);
        }
        principalId = createdPrincipal.id;
      }

      await tx
        .insert(principalWallets)
        .values({
          principalId,
          walletId,
          role: 'owner',
        })
        .onConflictDoUpdate({
          target: [principalWallets.principalId, principalWallets.walletId],
          set: { role: 'owner' },
        });

      const [existingDevice] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(eq(devices.externalDeviceId, externalDeviceId))
        .limit(1);

      if (existingDevice !== undefined) {
        await tx
          .update(devices)
          .set({
            walletId,
            enodeConnectionId: connectionId,
            vendor,
            model,
            displayName,
            status: 'active',
            lastSeenAt: new Date(),
            updatedAt: new Date(),
            metadata: {
              importedFromEnode: true,
              enodeUserId,
              isReachable: vehicle.isReachable === true,
            },
          })
          .where(eq(devices.id, existingDevice.id));
        devicesUpdated += 1;
        return 'updated' as const;
      }

      await tx.insert(devices).values({
        walletId,
        enodeConnectionId: connectionId,
        externalDeviceId,
        deviceType: 'vehicle',
        vendor,
        model,
        displayName,
        status: 'active',
        lastSeenAt: new Date(),
        metadata: {
          importedFromEnode: true,
          enodeUserId,
          isReachable: vehicle.isReachable === true,
        },
      });
      devicesCreated += 1;
      return 'created' as const;
    });

    console.log(
      `${result} ${displayName} (${externalDeviceId}) → ${walletAddress}`,
    );
  }

  const counts = await sqlClient`
    select 'wallets' as t, count(*)::int as c from wallets
    union all select 'devices', count(*)::int from devices
    union all select 'principals', count(*)::int from principals
    union all select 'principal_wallets', count(*)::int from principal_wallets
  `;

  await sqlClient.end({ timeout: 5 });

  console.log('');
  console.log(
    `Done. walletsCreated=${walletsCreated} devicesCreated=${devicesCreated} devicesUpdated=${devicesUpdated} skipped=${skipped}`,
  );
  console.log('Counts:', counts);
  console.log(
    'Next: pm2 restart web worker; log in with Web3Auth (binds your email principal to the wallet); optional pnpm enode:sync-telemetry',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
