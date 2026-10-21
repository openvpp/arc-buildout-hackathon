import { describe, expect, it } from 'vitest';

import {
  buildChargingCompletedPayload,
  buildDailyOdometerPayload,
  dailyTripIdFor,
} from '@/server/application/telemetry/device-event-payloads';
import {
  hashDeviceEventPayload,
  receiptHasDeviceEvent,
} from '@/server/infrastructure/blockchain/device-event-recorder';
import {
  computeRecordHash,
  newRecordSalt,
} from '@/server/application/telemetry/device-event-record';
import { decideOutboxFollowUp } from '@/server/infrastructure/jobs/outbox-follow-up';

const session = {
  deviceId: '11111111-2222-3333-4444-555555555555',
  sessionId: 'session_11111111-2222-3333-4444-555555555555_1791800593000',
  startTime: new Date('2026-10-12T10:23:13.000Z'),
  endTime: new Date('2026-10-12T10:29:38.974Z'),
  energyDeliveredKwh: 1.4334848833333278,
  endBatteryLevel: 100,
  energyMethod: 'estimated_from_battery_change' as const,
  electricityPrice: 0.12,
  totalCost: 0.17201818599999932,
  currency: 'USD',
};

describe('buildChargingCompletedPayload', () => {
  it('emits exactly the whitelisted fields, in order, with fixed rounding', () => {
    expect(buildChargingCompletedPayload(session)).toBe(
      '{"vehicleId":"11111111-2222-3333-4444-555555555555",' +
        '"sessionId":"session_11111111-2222-3333-4444-555555555555_1791800593000",' +
        '"energyDelivered":1.4335,' +
        '"startTime":"2026-10-12T10:23:13.000Z",' +
        '"endTime":"2026-10-12T10:29:38.974Z",' +
        '"batteryLevel":100,' +
        '"method":"estimated_from_battery_change",' +
        '"pointsAwarded":1,' +
        '"electricityPrice":0.12,' +
        '"totalCost":0.172,' +
        '"currency":"USD"}',
    );
  });

  it('never includes location or identity fields', () => {
    const json = buildChargingCompletedPayload(session);
    for (const forbidden of [
      'location',
      'latitude',
      'longitude',
      'wallet',
      'email',
      'userId',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('is deterministic, so the stored hash always matches', () => {
    expect(hashDeviceEventPayload(buildChargingCompletedPayload(session))).toBe(
      hashDeviceEventPayload(buildChargingCompletedPayload({ ...session })),
    );
  });
});

describe('recordHash in payloads', () => {
  it('appends recordHash last and leaves a v1 payload byte-identical', () => {
    const v1 = buildChargingCompletedPayload(session);
    const v2 = buildChargingCompletedPayload(session, {
      recordHash: `0x${'ab'.repeat(32)}`,
    });
    expect(v2.startsWith(v1.slice(0, -1))).toBe(true);
    expect(Object.keys(JSON.parse(v2)).at(-1)).toBe('recordHash');
    expect(buildChargingCompletedPayload(session, {})).toBe(v1);
  });

  it('depends on the salt, so values cannot be guessed from the hash', () => {
    const record = '{"kind":"charging_session"}';
    expect(computeRecordHash(`0x${'01'.repeat(32)}`, record)).not.toBe(
      computeRecordHash(`0x${'02'.repeat(32)}`, record),
    );
    expect(newRecordSalt()).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('buildDailyOdometerPayload', () => {
  it('publishes the UTC day in miles with its odometer bounds', () => {
    const json = buildDailyOdometerPayload({
      deviceId: 'dev-1',
      dateUtc: '2026-10-11',
      startOdometerKm: 16093.44,
      endOdometerKm: 16143.94,
      startEstimated: false,
    });
    expect(JSON.parse(json)).toEqual({
      vehicleId: 'dev-1',
      tripId: dailyTripIdFor('dev-1', '2026-10-11'),
      startTime: '2026-10-11T00:00:00.000Z',
      endTime: '2026-10-12T00:00:00.000Z',
      distanceTraveled: 31.379,
      duration: 1440,
      startOdometer: 10000,
      endOdometer: 10031.379,
      distanceUnit: 'mi',
      startEstimated: false,
    });
    // Key order is part of the byte-exact contract.
    expect(Object.keys(JSON.parse(json))[0]).toBe('vehicleId');
  });

  it('rolls the end time over month boundaries', () => {
    const json = buildDailyOdometerPayload({
      deviceId: 'dev-1',
      dateUtc: '2026-10-31',
      startOdometerKm: 0,
      endOdometerKm: 0,
      startEstimated: true,
    });
    expect(JSON.parse(json).endTime).toBe('2026-11-01T00:00:00.000Z');
  });
});

/**
 * Real DeviceEvent log from Arc mainnet tx
 * 0x179cf954f59004742ef1c4b04b92d42e13dd72d2a1b8c7448821f15ef9ad6c7e
 * (token 131, eventType 2). Proves our ABI decodes the deployed event,
 * including its trailing `timestamp` field.
 */
const MAINNET_CONTRACT = '0xE3C7B5215527017E964893c487f1553b7A513721';
const MAINNET_PAYLOAD =
  '{"vehicleId":"7a65502a-6534-48c3-9cd0-1bde354ea34c","sessionId":"session_7a65502a-6534-48c3-9cd0-1bde354ea34c_1791800678993","energyDelivered":1.4334848833333278,"startTime":"2026-10-12T10:23:13.000Z","endTime":"2026-10-12T10:29:38.974Z","batteryLevel":100,"location":{},"method":"direct_kwh","pointsAwarded":1,"electricityPrice":0.12,"totalCost":0.17201818599999932,"currency":"USD"}';
const MAINNET_LOG = {
  address: MAINNET_CONTRACT as `0x${string}`,
  topics: [
    '0x3de799dd7abe8fd56ddf6376287c6702888d24fbc26726a7d9bbfab1c3c53962',
    '0x0000000000000000000000000000000000000000000000000000000000000083',
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  ] as [`0x${string}`, ...`0x${string}`[]],
  data: ('0x' +
    '0000000000000000000000000000000000000000000000000000000000000040' +
    '000000000000000000000000000000000000000000000000000000006accb694' +
    '0000000000000000000000000000000000000000000000000000000000000180' +
    Buffer.from(MAINNET_PAYLOAD, 'utf8').toString('hex') +
    '0'.repeat(
      (64 - ((Buffer.byteLength(MAINNET_PAYLOAD) * 2) % 64)) % 64,
    )) as `0x${string}`,
};

describe('receiptHasDeviceEvent', () => {
  const expected = {
    tokenId: 131n,
    eventType: 2,
    payloadHash: hashDeviceEventPayload(MAINNET_PAYLOAD),
  };

  it('matches the real on-chain DeviceEvent log', () => {
    expect(
      receiptHasDeviceEvent([MAINNET_LOG], MAINNET_CONTRACT, expected),
    ).toBe(true);
  });

  it('rejects a log from another contract', () => {
    expect(
      receiptHasDeviceEvent(
        [MAINNET_LOG],
        '0x0000000000000000000000000000000000000001',
        expected,
      ),
    ).toBe(false);
  });

  it('rejects a different token, event type, or payload', () => {
    expect(
      receiptHasDeviceEvent([MAINNET_LOG], MAINNET_CONTRACT, {
        ...expected,
        tokenId: 132n,
      }),
    ).toBe(false);
    expect(
      receiptHasDeviceEvent([MAINNET_LOG], MAINNET_CONTRACT, {
        ...expected,
        eventType: 12,
      }),
    ).toBe(false);
    expect(
      receiptHasDeviceEvent([MAINNET_LOG], MAINNET_CONTRACT, {
        ...expected,
        payloadHash: hashDeviceEventPayload('{}'),
      }),
    ).toBe(false);
  });
});

describe('decideOutboxFollowUp for device events', () => {
  it('waits for the mint without burning attempts', () => {
    expect(
      decideOutboxFollowUp({
        outcome: 'waiting_for_mint',
        attempts: 3,
        maxAttempts: 5,
        hasInFlightTransaction: false,
        errorMessage: null,
      }),
    ).toMatchObject({ action: 'reschedule', attempts: 3, lastError: null });
  });

  it('fails an unrecognized receipt without marking the row again', () => {
    expect(
      decideOutboxFollowUp({
        outcome: 'unrecognized',
        attempts: 1,
        maxAttempts: 5,
        hasInFlightTransaction: true,
        errorMessage: null,
      }),
    ).toEqual({
      action: 'fail',
      attempts: 2,
      lastError: 'receipt did not match the device event',
      markTargetFailed: false,
    });
  });

  it('completes on confirmation or a terminal row', () => {
    for (const outcome of [
      'confirmed',
      'already_confirmed',
      'already_failed',
    ] as const) {
      expect(
        decideOutboxFollowUp({
          outcome,
          attempts: 0,
          maxAttempts: 5,
          hasInFlightTransaction: false,
          errorMessage: null,
        }),
      ).toEqual({ action: 'complete' });
    }
  });
});
