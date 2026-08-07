import 'server-only';

import { getAdminDeviceDetail } from '@/server/application/admin/get-admin-device-detail';
import { getContainer } from '@/server/bootstrap/container';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'admin-device-detail-loader' });

/**
 * Server Component loader for super-admin device detail (full payloads).
 * Caller must already have passed the admin session gate.
 */
export async function loadAdminDeviceDetail(deviceId: string) {
  try {
    const container = getContainer();
    const detail = await getAdminDeviceDetail(container.db, deviceId);
    if (detail === null) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    return { ok: true as const, detail };
  } catch (error: unknown) {
    log.warn('admin.device_detail.load_failed', {
      deviceId,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
