import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertTelemetryRecord = vi.fn();
const enqueueOutboxEvent = vi.fn();

vi.mock(
  '@/server/infrastructure/db/repositories/telemetry-payment-repository',
  () => ({
    insertTelemetryRecord: (...args: unknown[]): unknown =>
      insertTelemetryRecord(...args),
  }),
);

vi.mock('@/server/infrastructure/db/repositories/outbox-repository', () => ({
  enqueueOutboxEvent: (...args: unknown[]): unknown =>
    enqueueOutboxEvent(...args),
}));

import { ingestEnodeVehicleSnapshot } from '@/server/application/telemetry/ingest-enode-vehicle-snapshot';
import type { Database } from '@/server/infrastructure/db/client';

describe('ingestEnodeVehicleSnapshot', () => {
  const db = {} as Database;

  beforeEach(() => {
    insertTelemetryRecord.mockReset();
    enqueueOutboxEvent.mockReset();
  });

  it('inserts telemetry and enqueues ANCHOR_TELEMETRY when charge present', async () => {
    insertTelemetryRecord.mockResolvedValue({ id: 'tel-1' });
    enqueueOutboxEvent.mockResolvedValue({ id: 'out-1' });

    const result = await ingestEnodeVehicleSnapshot({
      db,
      deviceId: 'dev-1',
      externalDeviceId: 'veh-1',
      source: 'enode-onboard-snapshot',
      now: new Date('2026-08-08T12:00:00.000Z'),
      rawVehicle: {
        id: 'veh-1',
        chargeState: {
          batteryLevel: 55,
          batteryCapacity: 75,
          lastUpdated: '2026-08-08T11:59:00.000Z',
        },
      },
    });

    expect(result).toEqual({
      status: 'inserted',
      telemetryRecordId: 'tel-1',
    });
    expect(insertTelemetryRecord).toHaveBeenCalledOnce();
    const values = insertTelemetryRecord.mock.calls[0]?.[1] as {
      source: string;
      sourceEventId: string;
      telemetryPayload: {
        stateOfChargePercent: number;
        batteryCapacityKilowattHours: number;
      };
    };
    expect(values.source).toBe('enode-onboard-snapshot');
    expect(values.sourceEventId).toBe('enode-onboard-snapshot:veh-1:29769840');
    expect(values.telemetryPayload.stateOfChargePercent).toBe(55);
    expect(values.telemetryPayload.batteryCapacityKilowattHours).toBe(75);
    expect(enqueueOutboxEvent).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        eventType: 'ANCHOR_TELEMETRY',
        aggregateId: 'tel-1',
      }),
    );
  });

  it('skips empty charge payloads without writing', async () => {
    const result = await ingestEnodeVehicleSnapshot({
      db,
      deviceId: 'dev-1',
      externalDeviceId: 'veh-1',
      source: 'enode-api-sync',
      rawVehicle: { id: 'veh-1', information: { brand: 'TESLA' } },
    });

    expect(result).toEqual({ status: 'skipped_empty' });
    expect(insertTelemetryRecord).not.toHaveBeenCalled();
    expect(enqueueOutboxEvent).not.toHaveBeenCalled();
  });

  it('treats unique violations as duplicate', async () => {
    insertTelemetryRecord.mockRejectedValue(
      new Error('duplicate key value violates unique constraint'),
    );

    const result = await ingestEnodeVehicleSnapshot({
      db,
      deviceId: 'dev-1',
      externalDeviceId: 'veh-1',
      source: 'enode-api-sync',
      now: new Date('2026-08-08T12:00:00.000Z'),
      rawVehicle: {
        id: 'veh-1',
        chargeState: { batteryLevel: 10 },
      },
    });

    expect(result).toEqual({ status: 'duplicate' });
  });
});
