import { describe, expect, it } from 'vitest';

import {
  decodeEnodeUserId,
  encodeEnodeUserId,
} from '@/server/infrastructure/enode/user-id';
import {
  mapEnodeVehicle,
  pickEnodeVehicleIdFromList,
} from '@/server/infrastructure/enode/vehicle-mapper';

describe('enode user id encoding', () => {
  it('keeps production wallets bare and prefixes non-prod', () => {
    expect(encodeEnodeUserId('production', '0xAbC')).toBe('0xAbC');
    expect(encodeEnodeUserId('development', '0xAbC')).toBe(
      'development::0xAbC',
    );
    expect(decodeEnodeUserId('staging::0xwallet').appUserId).toBe('0xwallet');
  });
});

describe('enode vehicle mapper', () => {
  it('maps information.brand/model and picks by brand', () => {
    const mapped = mapEnodeVehicle({
      id: 'veh-1',
      information: { brand: 'Tesla', model: 'Model 3', year: 2024 },
    });
    expect(mapped).toEqual({
      vehicleId: 'veh-1',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      displayName: 'Tesla Model 3',
    });

    const id = pickEnodeVehicleIdFromList(
      [
        { id: 'a', information: { brand: 'BMW' } },
        { id: 'b', information: { brand: 'TESLA' } },
      ],
      'TESLA',
    );
    expect(id).toBe('b');
  });
});
