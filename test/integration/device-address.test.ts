import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { listAllDeviceLocations } from '@/server/application/dashboard/list-device-locations';
import {
  getDeviceAddressForOwner,
  setDeviceAddressForOwner,
} from '@/server/application/location/device-address';
import {
  distanceMeters,
  PUBLIC_LOCATION_MAX_OFFSET_M,
  PUBLIC_LOCATION_MIN_OFFSET_M,
} from '@/server/application/location/obfuscate-location';
import { deviceAddresses, devices } from '@/server/infrastructure/db/schema';
import type {
  AddressGeocoder,
  GeocodedAddress,
} from '@/server/infrastructure/geocoding/mapbox-geocoder';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const HOME: GeocodedAddress = {
  formattedAddress: '12 Test Lane, Springfield, Oregon 97477, United States',
  city: 'Springfield',
  region: 'Oregon',
  postalCode: '97477',
  countryCode: 'US',
  latitude: 44.046236,
  longitude: -123.022029,
  placeId: 'test-place-1',
  permanent: false,
};

function geocoderReturning(
  result: Awaited<ReturnType<AddressGeocoder['geocode']>>,
): AddressGeocoder {
  return { geocode: async () => result };
}

async function seedOwnedDevice(
  extra: Partial<typeof devices.$inferInsert> = {},
) {
  const { principal, wallet } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId: randomUUID(),
      ...extra,
    })
    .returning();
  if (device === undefined) {
    throw new Error('failed to seed device');
  }
  return { principal, wallet, device };
}

function setAddress(
  owner: Awaited<ReturnType<typeof seedOwnedDevice>>,
  geocoder: AddressGeocoder | null = geocoderReturning({
    ok: true,
    address: HOME,
  }),
  walletId: string = owner.wallet.id,
) {
  return setDeviceAddressForOwner(db, {
    deviceId: owner.device.id,
    walletId,
    principalId: owner.principal.id,
    address: { query: '12 Test Lane, Springfield', unit: 'Apt 2' },
    geocoderOverride: geocoder,
  });
}

describe('device address', () => {
  it('stores the geocoded address and a public point 0.5–2 km away', async () => {
    const owner = await seedOwnedDevice();
    const saved = await setAddress(owner);

    expect(saved).toMatchObject({
      formattedAddress: HOME.formattedAddress,
      unit: 'Apt 2',
      countryCode: 'US',
    });
    // The owner view carries no coordinates at all.
    expect(Object.keys(saved ?? {})).not.toContain('latitude');

    const [row] = await db
      .select()
      .from(deviceAddresses)
      .where(eq(deviceAddresses.deviceId, owner.device.id));
    const meters = distanceMeters(
      { latitude: HOME.latitude, longitude: HOME.longitude },
      {
        latitude: Number(row?.publicLatitude),
        longitude: Number(row?.publicLongitude),
      },
    );
    expect(meters).toBeGreaterThanOrEqual(PUBLIC_LOCATION_MIN_OFFSET_M - 1);
    expect(meters).toBeLessThanOrEqual(PUBLIC_LOCATION_MAX_OFFSET_M + 1);
  });

  it('is owner-only', async () => {
    const owner = await seedOwnedDevice();
    const stranger = await seedOwnedDevice();
    expect(await setAddress(owner, undefined, stranger.wallet.id)).toBeNull();
    expect(
      await getDeviceAddressForOwner(db, {
        deviceId: owner.device.id,
        walletId: stranger.wallet.id,
      }),
    ).toBeNull();
  });

  it('replaces the address instead of adding a second one', async () => {
    const owner = await seedOwnedDevice();
    await setAddress(owner);
    await setAddress(
      owner,
      geocoderReturning({
        ok: true,
        address: {
          ...HOME,
          formattedAddress: '99 Other Road, Eugene',
          placeId: 'p2',
        },
      }),
    );
    const rows = await db
      .select()
      .from(deviceAddresses)
      .where(eq(deviceAddresses.deviceId, owner.device.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.formattedAddress).toBe('99 Other Road, Eugene');
  });

  it('turns geocoder failures into client-safe errors and saves nothing', async () => {
    const owner = await seedOwnedDevice();
    await expect(
      setAddress(owner, geocoderReturning({ ok: false, reason: 'not_found' })),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_FOUND' });
    await expect(
      setAddress(
        owner,
        geocoderReturning({ ok: false, reason: 'not_precise' }),
      ),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_PRECISE' });
    await expect(setAddress(owner, null)).rejects.toMatchObject({
      code: 'ADDRESS_LOOKUP_UNAVAILABLE',
    });
    expect(
      await getDeviceAddressForOwner(db, {
        deviceId: owner.device.id,
        walletId: owner.wallet.id,
      }),
    ).toBeNull();
  });
});

describe('public globe privacy', () => {
  it('shows an address device only at its public point, never the address', async () => {
    const owner = await seedOwnedDevice();
    await setAddress(owner);

    const page = await listAllDeviceLocations(db, { limit: 200 });
    const pin = page.locations.find((l) => l.id === owner.device.id);
    expect(pin?.locationSource).toBe('address');
    expect(pin?.latitude).not.toBe(HOME.latitude);
    expect(pin?.longitude).not.toBe(HOME.longitude);

    const body = JSON.stringify(page);
    expect(body).not.toContain('Test Lane');
    expect(body).not.toContain(String(HOME.latitude));
  });

  it('prefers the address over the live location', async () => {
    const owner = await seedOwnedDevice({
      lastLatitude: '10.000000',
      lastLongitude: '20.000000',
    });
    await setAddress(owner);
    const page = await listAllDeviceLocations(db, { limit: 200 });
    const pin = page.locations.find((l) => l.id === owner.device.id);
    expect(pin?.locationSource).toBe('address');
  });

  it('offsets a live-only location 0.5–2 km, stably', async () => {
    const live = { latitude: 59.9139, longitude: 10.7522 };
    const owner = await seedOwnedDevice({
      lastLatitude: live.latitude.toFixed(6),
      lastLongitude: live.longitude.toFixed(6),
    });

    const first = await listAllDeviceLocations(db, { limit: 200 });
    const second = await listAllDeviceLocations(db, { limit: 200 });
    const pin = first.locations.find((l) => l.id === owner.device.id);
    const again = second.locations.find((l) => l.id === owner.device.id);

    expect(pin?.locationSource).toBe('live');
    expect(pin).toEqual(again);
    const meters = distanceMeters(live, {
      latitude: pin?.latitude ?? 0,
      longitude: pin?.longitude ?? 0,
    });
    expect(meters).toBeGreaterThanOrEqual(PUBLIC_LOCATION_MIN_OFFSET_M - 1);
    expect(meters).toBeLessThanOrEqual(PUBLIC_LOCATION_MAX_OFFSET_M + 1);
  });
});
