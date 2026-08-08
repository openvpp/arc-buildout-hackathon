import { describe, expect, it } from 'vitest';

import { summarizeFleetFlexibility } from '@/features/admin';

describe('summarizeFleetFlexibility', () => {
  it('totals headroom from latest verified readings only', () => {
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
          ],
        },
      ],
      (device) => device.displayName ?? device.externalDeviceId,
      (address) => address.slice(0, 6),
    );

    expect(summary.verifiedVehicleCount).toBe(2);
    expect(summary.includedVehicleCount).toBe(2);
    expect(summary.totalHeadroomKilowattHours).toBe(67.5);
    expect(summary.vehicles[1]?.headroom.ok).toBe(false);
  });
});
