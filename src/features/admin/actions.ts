'use server';

import { and, desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { backfillTokenFromExplorer } from '@/server/application/verification/chain-event-index';
import { verifyStoredDeviceEvent } from '@/server/application/verification/verify-stored-event';
import { getDb } from '@/server/infrastructure/db/client';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

import { requireAdminSession } from './server';

const log = createServerLogger({ component: 'admin-actions' });

/** "Verify all" re-checks at most this many of a device's newest records. */
const VERIFY_ALL_LIMIT = 25;

export type AdminActionState = {
  readonly message: string | null;
  readonly ok: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function adminOrNull() {
  const session = await requireAdminSession();
  return session.ok ? session.admin : null;
}

function failed(message: string): AdminActionState {
  return { ok: false, message };
}

/** Re-verify one record now, attributed to the signed-in admin. */
export async function verifyRecordAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await adminOrNull();
  if (admin === null)
    return failed('Your admin session has ended. Sign in again.');
  const id = String(formData.get('deviceEventId') ?? '');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(id) || !UUID.test(deviceId)) return failed('Unknown record.');
  try {
    const result = await verifyStoredDeviceEvent({
      db: getDb(),
      deviceEventId: id,
      checkedBy: `admin:${admin.username}`,
    });
    revalidatePath(`/admin/devices/${deviceId}`);
    return {
      ok: true,
      message: `Checked: ${result.verdict.replaceAll('_', ' ')}.`,
    };
  } catch (error) {
    log.warn('admin.verify_failed', {
      deviceEventId: id,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return failed('The Arc RPC did not answer. Try again in a moment.');
  }
}

/** Re-verify a device's newest anchored records (bounded). */
export async function verifyDeviceAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await adminOrNull();
  if (admin === null)
    return failed('Your admin session has ended. Sign in again.');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(deviceId)) return failed('Unknown device.');
  const db = getDb();
  const records = await db
    .select({ id: deviceEvents.id })
    .from(deviceEvents)
    .where(
      and(
        eq(deviceEvents.deviceId, deviceId),
        eq(deviceEvents.status, 'confirmed'),
      ),
    )
    .orderBy(desc(deviceEvents.occurredAt))
    .limit(VERIFY_ALL_LIMIT);
  const tally = new Map<string, number>();
  let errors = 0;
  for (const record of records) {
    try {
      const result = await verifyStoredDeviceEvent({
        db,
        deviceEventId: record.id,
        checkedBy: `admin:${admin.username}`,
      });
      tally.set(result.verdict, (tally.get(result.verdict) ?? 0) + 1);
    } catch {
      errors += 1;
    }
  }
  revalidatePath(`/admin/devices/${deviceId}`);
  const parts = [...tally.entries()].map(
    ([verdict, n]) => `${n} ${verdict.replaceAll('_', ' ')}`,
  );
  if (errors > 0) parts.push(`${errors} could not be read (RPC)`);
  return {
    ok: errors === 0,
    message:
      records.length === 0
        ? 'No anchored records to verify.'
        : `Checked ${records.length}: ${parts.join(', ')}.`,
  };
}

/** Pull this device's token history from the explorer into the chain index. */
export async function syncDeviceFromChainAction(
  _previous: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await adminOrNull();
  if (admin === null)
    return failed('Your admin session has ended. Sign in again.');
  const deviceId = String(formData.get('deviceId') ?? '');
  if (!UUID.test(deviceId)) return failed('Unknown device.');
  const [device] = await getDb()
    .select({ tokenId: devices.nftTokenId })
    .from(devices)
    .where(eq(devices.id, deviceId))
    .limit(1);
  if (device?.tokenId === null || device?.tokenId === undefined) {
    return failed(
      'This device has no DeviceNFT on the configured contract yet.',
    );
  }
  const result = await backfillTokenFromExplorer(
    getDb(),
    BigInt(device.tokenId),
  );
  revalidatePath(`/admin/devices/${deviceId}`);
  switch (result.status) {
    case 'unconfigured':
      return failed('No DeviceNFT contract is configured.');
    case 'explorer_unavailable':
      return failed(
        result.reason === 'blocked'
          ? 'The explorer API blocked this server (set ARC_EXPLORER_API_URL to a keyed endpoint). The forward scanner still indexes new events.'
          : 'The explorer API did not answer. Try again later.',
      );
    case 'backfilled':
      return {
        ok: true,
        message: `Found ${result.found} on-chain event(s) for token ${device.tokenId}; ${result.inserted} new.`,
      };
  }
}
