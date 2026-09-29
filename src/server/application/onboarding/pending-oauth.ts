import { eq } from 'drizzle-orm';

import { ApplicationError } from '@/server/application/application-error';
import type { Database } from '@/server/infrastructure/db/client';
import { pendingDeviceConnections } from '@/server/infrastructure/db/schema';
import { createHttpEnodeVehicleClient } from '@/server/infrastructure/enode/http-client';
import { encodeEnodeUserId } from '@/server/infrastructure/enode/user-id';
import { pickEnodeVehicleIdFromList } from '@/server/infrastructure/enode/vehicle-mapper';

const TERMINAL = new Set(['completed', 'failed', 'expired', 'cancelled']);

type PendingRow = typeof pendingDeviceConnections.$inferSelect;

async function loadPending(
  db: Database,
  id: string,
): Promise<PendingRow | null> {
  const [row] = await db
    .select()
    .from(pendingDeviceConnections)
    .where(eq(pendingDeviceConnections.id, id))
    .limit(1);
  return row ?? null;
}

async function markExpiredIfNeeded(
  db: Database,
  pending: PendingRow,
): Promise<PendingRow> {
  if (TERMINAL.has(pending.status) || pending.expiresAt >= new Date()) {
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
  input: { pendingId: string; walletId: string },
): Promise<{ pendingId: string; status: string; requiresForm: boolean }> {
  const pending = await loadPending(db, input.pendingId);
  // Same response for a missing id and someone else's id. Do not mutate
  // the row — a guessed id must not be able to fail another wallet's link.
  if (pending === null || pending.walletId !== input.walletId) {
    throw new ApplicationError(
      'PENDING_CONNECTION_NOT_FOUND',
      'Pending connection not found.',
    );
  }
  const current = await markExpiredIfNeeded(db, pending);
  if (TERMINAL.has(current.status)) {
    throw new ApplicationError(
      'PENDING_INVALID_STATUS',
      'This connection can no longer be completed.',
    );
  }

  const enodeUserId = encodeEnodeUserId(current.walletId);
  const client = createHttpEnodeVehicleClient();

  let providerDeviceId = current.providerDeviceId ?? undefined;
  try {
    const list = await client.getUserVehicles(enodeUserId);
    providerDeviceId =
      pickEnodeVehicleIdFromList(list, current.normalizedBrand) ??
      providerDeviceId;
  } catch {
    /* best-effort discovery; the form step retries via getUserVehicles too */
  }

  const [updated] = await db
    .update(pendingDeviceConnections)
    .set({
      status: 'pending_form',
      providerUserId: enodeUserId,
      providerDeviceId: providerDeviceId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(pendingDeviceConnections.id, current.id))
    .returning();

  return {
    pendingId: current.id,
    status: updated?.status ?? 'pending_form',
    requiresForm: true,
  };
}

export async function getPendingConnection(
  db: Database,
  input: { id: string; walletId: string },
) {
  const pending = await loadPending(db, input.id);
  if (pending === null || pending.walletId !== input.walletId) {
    return null;
  }
  const current = await markExpiredIfNeeded(db, pending);
  return {
    id: current.id,
    status: current.status,
    expiresAt: current.expiresAt.toISOString(),
    requiresForm: current.status === 'pending_form',
  };
}
