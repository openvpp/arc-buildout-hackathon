import { describe, expect, it } from 'vitest';

import { summarizeFleetFlexibility } from './fleet-flexibility';

describe('summarizeFleetFlexibility', () => {
  it('prefers verified readings and falls back to latest unlocked', () => {
    const summary = summarizeFleetFlexibility(
      [
        {
          wallet: { label: 'Fleet A', address: '0xabc' },
          devices: [
            {
              device: {
                id: 'd1',
                displayName: 'Car 1',
                vendor: null,
                model: null,
                externalDeviceId: 'v1',
              },
              latest: {
                telemetryPayload: {
                  stateOfChargePercent: 99,
                  batteryCapacityKilowattHours: 40,
                },
              },
              latestVerified: {
                telemetryPayload: {
                  stateOfChargePercent: 10,
                  batteryCapacityKilowattHours: 75,
                },
              },
            },
            {
              device: {
                id: 'd2',
                displayName: 'Car 2',
                vendor: null,
                model: null,
                externalDeviceId: 'v2',
              },
              latest: {
                telemetryPayload: {
                  stateOfChargePercent: 50,
                  batteryCapacityKilowattHours: 60,
                },
              },
              latestVerified: null,
            },
            {
              device: {
                id: 'd3',
                displayName: 'Car 3',
                vendor: null,
                model: null,
                externalDeviceId: 'v3',
              },
              latestVerified: {
                telemetryPayload: {
                  stateOfChargePercent: 100,
                  batteryCapacityKilowattHours: 75,
                },
              },
            },
            {
              device: {
                id: 'd4',
                displayName: 'Car 4',
                vendor: null,
                model: null,
                externalDeviceId: 'v4',
              },
              latest: null,
              latestVerified: null,
            },
          ],
        },
      ],
      (device) => device.displayName ?? device.externalDeviceId,
      (address) => address.slice(0, 6),
    );

    expect(summary.verifiedVehicleCount).toBe(2);
    expect(summary.includedVehicleCount).toBe(3);
    // Car1 uses verified 10% of 75 → 67.5; Car2 unverified 50% of 60 → 30; Car3 0
    expect(summary.totalHeadroomKilowattHours).toBe(97.5);
    expect(summary.vehicles[0]?.stateOfChargePercent).toBe(10);
    expect(summary.vehicles[1]?.stateOfChargePercent).toBe(50);
    expect(summary.vehicles[1]?.hasVerifiedReading).toBe(false);
    expect(summary.vehicles[3]?.headroom.ok).toBe(false);
  });
});
