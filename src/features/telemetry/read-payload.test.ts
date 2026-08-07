import { describe, expect, it } from 'vitest';

import { readTelemetryReadingFields } from '@/features/telemetry';

describe('readTelemetryReadingFields', () => {
  it('formats a full normalized payload', () => {
    const fields = readTelemetryReadingFields({
      stateOfChargePercent: 81,
      isCharging: true,
      isPluggedIn: true,
      rangeKilometers: 240,
      odometerKilometers: 12_340,
      chargeRateKilowatts: 7.2,
      powerKilowatts: -1.5,
      latitude: 59.91,
      longitude: 10.75,
    });

    expect(fields).toEqual([
      { label: 'State of charge', value: '81%' },
      { label: 'Charging', value: 'Yes' },
      { label: 'Plugged in', value: 'Yes' },
      { label: 'Range', value: '240 km' },
      { label: 'Odometer', value: '12340 km' },
      { label: 'Charge rate', value: '7.2 kW' },
      { label: 'Power', value: '-1.5 kW' },
      { label: 'Latitude', value: '59.91' },
      { label: 'Longitude', value: '10.75' },
    ]);
  });

  it('uses em dashes for nulls and unknown payloads', () => {
    expect(readTelemetryReadingFields(null)[0]?.value).toBe('—');
    expect(
      readTelemetryReadingFields({
        stateOfChargePercent: null,
        isCharging: null,
      })[0]?.value,
    ).toBe('—');
    expect(
      readTelemetryReadingFields({
        stateOfChargePercent: null,
        isCharging: false,
      })[1]?.value,
    ).toBe('No');
  });
});
