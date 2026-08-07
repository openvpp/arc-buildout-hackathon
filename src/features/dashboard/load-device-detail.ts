import 'server-only';

import { getBoundDeviceDetail } from '@/server/application/dashboard/list-dashboard';
import { getContainer } from '@/server/bootstrap/container';
import { createServerLogger } from '@/server/infrastructure/logging/logger';

const log = createServerLogger({ component: 'device-detail-loader' });

/**
 * Server Component loader for a single bound vehicle/device and its
 * owner-visible telemetry history (full payloads + verification fields).
 */
export async function loadDeviceDetail(deviceId: string) {
  try {
    const container = getContainer();
    const detail = await getBoundDeviceDetail(container.db, deviceId);
    if (detail === null) {
      return { ok: false as const, reason: 'not_found' as const };
    }
    return { ok: true as const, detail };
  } catch (error: unknown) {
    log.warn('device_detail.load_failed', {
      deviceId,
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false as const, reason: 'database_unavailable' as const };
  }
}
