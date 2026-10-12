import { describe, expect, it } from 'vitest';

import { mapOvppVehicle } from '@/server/application/import/map-ovpp-vehicle';

const TOKEN = 'super-secret-smartcar-token-value';

function vehicle(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: '00000000-0000-4000-8000-0000000000a1',
    userId: '0xAbCdEf0000000000000000000000000000000001',
    tokenEnc: TOKEN,
    attrs: { make: 'TESLA', model: 'Model Y', year: 2025 },
    deviceName: 'TESLA Model Y',
    fuelType: 'electric',
    status: 'enabled',
    isActive: true,
    smartcarConnectionStatus: 'expired',
    location: {
      latitude: 45.5,
      longitude: -75.25,
      lastUpdated: { $date: '2025-09-29T20:37:54.219Z' },
    },
    nftTokenId: 4,
    arcMintStatus: 'minted',
    arcNftTokenId: 3,
    arcOnchainTxHash:
      '0xabababababababababababababababababababababababababababababababab',
    address: '100 Example Road, Sampletown',
    createdAt: { $date: '2025-09-29T20:38:00.541Z' },
    ...overrides,
  };
}

describe('mapOvppVehicle', () => {
  it('maps a located vehicle and drops secrets and street address', () => {
    const mapped = mapOvppVehicle(vehicle());
    expect(mapped.ok).toBe(true);
    if (!mapped.ok) {
      return;
    }
    expect(mapped.vehicle).toMatchObject({
      vehicleId: '00000000-0000-4000-8000-0000000000a1',
      ownerAddress: '0xabcdef0000000000000000000000000000000001',
      provider: 'smartcar',
      vendor: 'TESLA',
      model: 'Model Y',
      displayName: 'TESLA Model Y',
      status: 'active',
      latitude: '45.500000',
      longitude: '-75.250000',
    });
    expect(mapped.vehicle.metadata).toEqual({
      legacySource: 'ovpp-vehicles',
      year: 2025,
      fuelType: 'electric',
      legacyArcMintStatus: 'minted',
      legacyArcNftTokenId: '3',
      legacyArcTxHash:
        '0xabababababababababababababababababababababababababababababababab',
    });
    expect(JSON.stringify(mapped.vehicle)).not.toContain(TOKEN);
    expect(JSON.stringify(mapped.vehicle)).not.toContain('Example Road');
    expect(mapped.vehicle.lastLocationAt?.toISOString()).toBe(
      '2025-09-29T20:37:54.219Z',
    );
  });

  it('keeps an explicit enode provider and maps revoked vehicles to disconnected', () => {
    const mapped = mapOvppVehicle(
      vehicle({
        provider: 'enode',
        smartcarConnectionStatus: 'revoked',
        status: 'enabled',
        isActive: true,
      }),
    );
    expect(mapped.ok && mapped.vehicle.provider).toBe('enode');
    expect(mapped.ok && mapped.vehicle.status).toBe('disconnected');
  });

  it('maps disabled and inactive vehicles to inactive', () => {
    const disabled = mapOvppVehicle(
      vehicle({ status: 'disabled', isActive: true }),
    );
    const inactive = mapOvppVehicle(
      vehicle({ status: 'enabled', isActive: false }),
    );
    expect(disabled.ok && disabled.vehicle.status).toBe('inactive');
    expect(inactive.ok && inactive.vehicle.status).toBe('inactive');
  });

  it('imports a vehicle with no usable location', () => {
    const mapped = mapOvppVehicle(
      vehicle({ location: { latitude: 91, longitude: 0 } }),
    );
    expect(mapped.ok && mapped.vehicle.latitude).toBeNull();
    expect(mapped.ok && mapped.vehicle.longitude).toBeNull();
  });

  it('skips documents that cannot be attached to an owner', () => {
    expect(mapOvppVehicle(null)).toEqual({ ok: false, reason: 'not_object' });
    expect(mapOvppVehicle({ userId: '0xabc' })).toEqual({
      ok: false,
      reason: 'missing_vehicle_id',
    });
    expect(
      mapOvppVehicle({ vehicleId: 'veh-1', userId: 'not-an-address' }),
    ).toEqual({
      ok: false,
      reason: 'invalid_owner_address',
    });
  });
});
