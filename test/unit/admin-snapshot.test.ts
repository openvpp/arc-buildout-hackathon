import { describe, expect, it } from 'vitest';

import { ADMIN_TELEMETRY_HISTORY_LIMIT } from '@/server/application/admin/list-admin-snapshot';

describe('admin snapshot constants', () => {
  it('keeps recent telemetry history bounded to 20 rows', () => {
    expect(ADMIN_TELEMETRY_HISTORY_LIMIT).toBe(20);
  });
});
