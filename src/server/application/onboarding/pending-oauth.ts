import { eq } from 'drizzle-orm';

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
): Promise<
  | { ok: true; pendingId: string; status: string; requiresForm: boolean }
  | { ok: false; message: string }
> {
  const pending = await loadPending(db, input.pendingId);
  if (pending === null) {
    return { ok: false, message: 'Pending connection not found' };
  }
  const current = await markExpiredIfNeeded(db, pending);
  if (current.walletId !== input.walletId) {
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
    ok: true,
    pendingId: current.id,
    status: updated?.status ?? 'pending_form',
    requiresForm: true,
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
    status: current.status,
    expiresAt: current.expiresAt.toISOString(),
    requiresForm: current.status === 'pending_form',
  };
}
