import { eq } from 'drizzle-orm';

import type { Database } from '@/server/infrastructure/db/client';
import { normalizeEvmAddress } from '@/server/infrastructure/db/repositories/wallet-repository';
import { pendingDeviceConnections } from '@/server/infrastructure/db/schema';
import { createHttpEnodeVehicleClient } from '@/server/infrastructure/enode/http-client';
import { encodeEnodeUserId } from '@/server/infrastructure/enode/user-id';
import { pickEnodeVehicleIdFromList } from '@/server/infrastructure/enode/vehicle-mapper';

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled']);

async function loadPending(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(pendingDeviceConnections)
    .where(eq(pendingDeviceConnections.id, id))
    .limit(1);
  return row ?? null;
}

async function markExpiredIfNeeded(
  db: Database,
  pending: typeof pendingDeviceConnections.$inferSelect,
): Promise<typeof pendingDeviceConnections.$inferSelect> {
  if (TERMINAL.has(pending.status)) {
    return pending;
  }
  if (pending.expiresAt >= new Date()) {
    return pending;
  }
  const [updated] = await db
    .update(pendingDeviceConnections)
    .set({
      status: 'expired',
      error: { code: 'EXPIRED', message: 'Connection window expired' },
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, pending.id))
    .returning();
  return updated ?? pending;
}

export async function onEnodeOAuthComplete(
  db: Database,
  input: {
    pendingId: string;
    walletAddress: string;
  },
): Promise<
  | {
      ok: true;
      pendingId: string;
      status: string;
      providerDeviceId?: string;
      requiresForm: boolean;
    }
  | { ok: false; message: string }
> {
  const pending = await loadPending(db, input.pendingId);
  if (pending === null) {
    return { ok: false, message: 'Pending connection not found' };
  }

  const current = await markExpiredIfNeeded(db, pending);
  const normalized = normalizeEvmAddress(input.walletAddress);
  if (current.normalizedWalletAddress !== normalized) {
    await db
      .update(pendingDeviceConnections)
      .set({
        status: 'failed',
        error: { code: 'USER_MISMATCH', message: 'wallet mismatch' },
        updatedAt: new Date(),
      })
      .where(eq(pendingDeviceConnections.id, current.id));
    return { ok: false, message: 'wallet mismatch' };
  }
  if (TERMINAL.has(current.status)) {
    return { ok: false, message: `Invalid status: ${current.status}` };
  }

  const enodeUserId = encodeEnodeUserId(
    current.environment,
    current.walletAddress,
  );
  const client = createHttpEnodeVehicleClient(db);

  let providerDeviceId = current.providerDeviceId ?? undefined;
  let listCount = 0;
  try {
    const list = await client.getUserVehicles(enodeUserId);
    listCount = list.length;
    providerDeviceId =
      pickEnodeVehicleIdFromList(list, current.normalizedBrand) ??
      providerDeviceId;
  } catch (e) {
    await db
      .update(pendingDeviceConnections)
      .set({
        providerData: {
          ...(current.providerData ?? {}),
          enode: {
            listError: e instanceof Error ? e.message : 'list failed',
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(pendingDeviceConnections.id, current.id));
  }

  const [updated] = await db
    .update(pendingDeviceConnections)
    .set({
      status: 'pending_form',
      providerUserId: enodeUserId,
      providerDeviceId: providerDeviceId ?? null,
      providerData: {
        ...(current.providerData ?? {}),
        enode: {
          lastOAuthAt: new Date().toISOString(),
          listCount,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, current.id))
    .returning();

  const status = updated?.status ?? 'pending_form';
  return {
    ok: true,
    pendingId: current.id,
    status,
    ...(providerDeviceId !== undefined ? { providerDeviceId } : {}),
    requiresForm: status === 'pending_form' || status === 'oauth_completed',
  };
}

export async function getPendingConnection(db: Database, id: string) {
  const pending = await loadPending(db, id);
  if (pending === null) {
    return null;
  }
  const current = await markExpiredIfNeeded(db, pending);
  return {
    id: current.id,
    walletAddress: current.walletAddress,
    status: current.status,
    providerDeviceId: current.providerDeviceId,
    expiresAt: current.expiresAt.toISOString(),
    requiresForm:
      current.status === 'pending_form' || current.status === 'oauth_completed',
  };
}
