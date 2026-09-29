import { describe, expect, it } from 'vitest';

import {
  DEVICE_TYPES,
  getProviderDeviceMintTypeId,
} from '@/server/infrastructure/blockchain/device-types';

describe('getProviderDeviceMintTypeId', () => {
  it('resolves electric_vehicle to the on-chain ELECTRIC_VEHICLE typeId', () => {
    expect(getProviderDeviceMintTypeId('electric_vehicle')).toBe(
      DEVICE_TYPES.ELECTRIC_VEHICLE,
    );
    expect(DEVICE_TYPES.ELECTRIC_VEHICLE).toBe(1);
  });

  it('resolves the other reserved classes to distinct typeIds', () => {
    const resolved = [
      getProviderDeviceMintTypeId('charger'),
      getProviderDeviceMintTypeId('battery'),
      getProviderDeviceMintTypeId('solar'),
      getProviderDeviceMintTypeId('thermostat'),
    ];
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  it('fails loudly on an unrecognized device class rather than guessing', () => {
    expect(() => getProviderDeviceMintTypeId('scooter')).toThrow(
      /Unknown deviceType/,
    );
  });
});
