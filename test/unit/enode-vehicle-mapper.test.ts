import { describe, expect, it } from 'vitest';

import {
  mapEnodeVehicle,
  pickEnodeVehicleIdFromList,
} from '@/server/infrastructure/enode/vehicle-mapper';

describe('mapEnodeVehicle', () => {
  it('maps a full vehicle payload including location', () => {
    const mapped = mapEnodeVehicle({
      id: 'veh-1',
      nickname: 'My Tesla',
      information: { brand: 'Tesla', model: 'Model 3', year: 2022 },
      location: { latitude: 37.7749, longitude: -122.4194 },
    });
    expect(mapped).toEqual({
      vehicleId: 'veh-1',
      make: 'Tesla',
      model: 'Model 3',
      year: 2022,
      displayName: 'My Tesla',
      latitude: 37.7749,
      longitude: -122.4194,
    });
  });

  it('returns null latitude/longitude when location is absent', () => {
    const mapped = mapEnodeVehicle({
      id: 'veh-2',
      information: { brand: 'Rivian' },
    });
    expect(mapped?.latitude).toBeNull();
    expect(mapped?.longitude).toBeNull();
  });

  it('returns null for a payload with no id', () => {
    expect(mapEnodeVehicle({ information: { brand: 'Tesla' } })).toBeNull();
  });
});

describe('pickEnodeVehicleIdFromList', () => {
  const list = [
    { id: 'a', information: { brand: 'Tesla' } },
    { id: 'b', information: { brand: 'Rivian' } },
  ];

  it('picks the vehicle matching the requested brand', () => {
    expect(pickEnodeVehicleIdFromList(list, 'RIVIAN')).toBe('b');
  });

  it('falls back to the first vehicle when brand is unspecified', () => {
    expect(pickEnodeVehicleIdFromList(list)).toBe('a');
  });

  it('returns undefined for an empty list', () => {
    expect(pickEnodeVehicleIdFromList([])).toBeUndefined();
  });
});
