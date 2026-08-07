import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { receiveEnodeWebhook } from '@/server/application/webhooks/enode-webhook';
import { resetServerEnvCache } from '@/server/config/env';
import type { Database } from '@/server/infrastructure/db/client';
import { wireEnvironmentForAppEnv } from '@/server/infrastructure/enode/user-id';
import {
  coerceEnodeVehicleEvent,
  extractEnodeEventUserId,
  isEmptyTelemetryData,
  mapUnifiedEnodeVehicleEvent,
} from '@/server/infrastructure/enode/webhook-mapper';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>)[key];
    return;
  }
  (process.env as Record<string, string | undefined>)[key] = value;
}

function mappedData(raw: unknown) {
  const coerced = coerceEnodeVehicleEvent(raw);
  if (coerced === null) throw new Error('event did not coerce');
  return mapUnifiedEnodeVehicleEvent(coerced).data;
}

describe('webhook mapper guards', () => {
  it('isEmptyTelemetryData is true when a discovered event carries no readings', () => {
    const data = mappedData({
      event: 'user:vehicle:discovered',
      vehicle: { id: 'veh-empty' },
    });
    expect(isEmptyTelemetryData(data)).toBe(true);
  });

  it('isEmptyTelemetryData is false when any field is present', () => {
    const data = mappedData({
      event: 'user:vehicle:updated',
      vehicle: { id: 'veh-1', chargeState: { batteryLevel: 40 } },
    });
    expect(isEmptyTelemetryData(data)).toBe(false);
  });

  it('extractEnodeEventUserId reads production user.id and legacy userId', () => {
    expect(
      extractEnodeEventUserId({ event: 'x', user: { id: 'staging::0xabc' } }),
    ).toBe('staging::0xabc');
    expect(extractEnodeEventUserId({ userId: '0xdef' })).toBe('0xdef');
    expect(extractEnodeEventUserId({ event: 'x' })).toBeNull();
  });

  it('wireEnvironmentForAppEnv collapses demo into production', () => {
    expect(wireEnvironmentForAppEnv('production')).toBe('production');
    expect(wireEnvironmentForAppEnv('demo')).toBe('production');
    expect(wireEnvironmentForAppEnv('staging')).toBe('staging');
    expect(wireEnvironmentForAppEnv('test')).toBe('test');
  });
});

describe('receiveEnodeWebhook tenancy guard', () => {
  const previous = {
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
    ENODE_WEBHOOK_SECRET: process.env.ENODE_WEBHOOK_SECRET,
  };

  beforeEach(() => {
    resetServerEnvCache();
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('ENODE_WEBHOOK_SECRET', undefined);
  });

  afterEach(() => {
    setEnv('ALLOW_MOCK_ADAPTERS', previous.ALLOW_MOCK_ADAPTERS);
    setEnv('APP_ENV', previous.APP_ENV);
    setEnv('ENODE_WEBHOOK_SECRET', previous.ENODE_WEBHOOK_SECRET);
    resetServerEnvCache();
  });

  it('drops a delivery whose events all belong to another environment', async () => {
    // APP_ENV=test → wire env "test". A bare-wallet user id decodes to
    // "production", so this delivery is foreign and must be dropped before any
    // DB access (the stub db throws if touched).
    const throwingDb = new Proxy(
      {},
      {
        get() {
          throw new Error('db must not be touched for a foreign-env delivery');
        },
      },
    ) as unknown as Database;

    const body = JSON.stringify([
      {
        event: 'user:vehicle:updated',
        user: { id: '0x9999999999999999999999999999999999999999' },
        vehicle: { id: 'veh-prod', chargeState: { batteryLevel: 50 } },
      },
    ]);

    const result = await receiveEnodeWebhook({
      db: throwingDb,
      rawBody: Buffer.from(body, 'utf8'),
      headers: {},
      signatureHeader: null,
    });

    expect(result.dropped).toBe(true);
    expect(result.duplicate).toBe(false);
  });
});
