import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApplicationError } from '@/server/application/application-error';
import { obfuscateCoordinates } from '@/server/application/location/obfuscate-location';
import { getServerEnv, type ServerEnv } from '@/server/config/env';
import type {
  Database,
  DatabaseExecutor,
} from '@/server/infrastructure/db/client';
import { deviceAddresses, devices } from '@/server/infrastructure/db/schema';
import {
  createMapboxGeocoder,
  type AddressGeocoder,
  type GeocodedAddress,
} from '@/server/infrastructure/geocoding/mapbox-geocoder';

/**
 * What the browser sends: the address text (normally a suggestion the user
 * picked) and an optional unit. Never coordinates — the server geocodes.
 */
export const deviceAddressInputSchema = z
  .object({
    query: z.string().trim().min(5).max(300),
    unit: z.string().trim().max(40).optional(),
  })
  .strict();

export type DeviceAddressInput = z.infer<typeof deviceAddressInputSchema>;

/** The owner's view. Coordinates are never returned to the browser. */
export type OwnerDeviceAddress = {
  formattedAddress: string;
  unit: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  countryCode: string | null;
  updatedAt: Date;
};

export function locationObfuscationSecret(env: ServerEnv): string {
  return env.LOCATION_OBFUSCATION_SECRET.length > 0
    ? env.LOCATION_OBFUSCATION_SECRET
    : env.API_KEY_HASH_SECRET;
}

/** Geocodes server-side; throws a client-safe ApplicationError on failure. */
export async function resolveDeviceAddress(
  input: DeviceAddressInput,
  geocoderOverride?: AddressGeocoder | null,
): Promise<GeocodedAddress> {
  const geocoder =
    geocoderOverride !== undefined ? geocoderOverride : createMapboxGeocoder();
  if (geocoder === null) {
    throw new ApplicationError(
      'ADDRESS_LOOKUP_UNAVAILABLE',
      'Address lookup is not available right now.',
    );
  }
  const result = await geocoder.geocode(input.query);
  if (result.ok) {
    return result.address;
  }
  switch (result.reason) {
    case 'not_found':
      throw new ApplicationError(
        'ADDRESS_NOT_FOUND',
        'We could not find that address. Pick one of the suggestions.',
      );
    case 'not_precise':
      throw new ApplicationError(
        'ADDRESS_NOT_PRECISE',
        'Enter a full street address, not just a city or area.',
      );
    case 'unavailable':
      throw new ApplicationError(
        'ADDRESS_LOOKUP_UNAVAILABLE',
        'Address lookup is not available right now.',
      );
  }
}

/**
 * Upserts a device's address. The public point is fixed here, offset
 * 0.5–2 km from the real one, keyed by device + place so a new address gets
 * an unrelated offset.
 */
export async function saveDeviceAddress(
  db: DatabaseExecutor,
  input: {
    deviceId: string;
    principalId: string | null;
    address: GeocodedAddress;
    unit: string | null;
  },
): Promise<OwnerDeviceAddress> {
  const { address } = input;
  const publicPoint = obfuscateCoordinates(
    { latitude: address.latitude, longitude: address.longitude },
    {
      secret: locationObfuscationSecret(getServerEnv()),
      key: `address:${input.deviceId}:${address.placeId ?? address.formattedAddress}`,
    },
  );
  const values = {
    formattedAddress: address.formattedAddress,
    unit: input.unit !== null && input.unit.length > 0 ? input.unit : null,
    city: address.city,
    region: address.region,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    latitude: address.latitude.toFixed(6),
    longitude: address.longitude.toFixed(6),
    publicLatitude: publicPoint.latitude.toFixed(6),
    publicLongitude: publicPoint.longitude.toFixed(6),
    geocoder: 'mapbox',
    geocoderPlaceId: address.placeId,
    geocodedPermanent: address.permanent,
    updatedByPrincipalId: input.principalId,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(deviceAddresses)
    .values({ deviceId: input.deviceId, ...values })
    .onConflictDoUpdate({ target: deviceAddresses.deviceId, set: values })
    .returning();
  if (row === undefined) {
    throw new ApplicationError(
      'DEVICE_PERSIST_FAILED',
      'Failed to save the address.',
    );
  }
  return toOwnerView(row);
}

function toOwnerView(
  row: typeof deviceAddresses.$inferSelect,
): OwnerDeviceAddress {
  return {
    formattedAddress: row.formattedAddress,
    unit: row.unit,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    countryCode: row.countryCode,
    updatedAt: row.updatedAt,
  };
}

/** Owner-only. Returns null when the device isn't owned by `walletId`. */
export async function setDeviceAddressForOwner(
  db: Database,
  input: {
    deviceId: string;
    walletId: string;
    principalId: string;
    address: DeviceAddressInput;
    geocoderOverride?: AddressGeocoder | null;
  },
): Promise<OwnerDeviceAddress | null> {
  const [owned] = await db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(eq(devices.id, input.deviceId), eq(devices.walletId, input.walletId)),
    )
    .limit(1);
  if (owned === undefined) {
    return null;
  }
  // Network call outside any transaction.
  const geocoded = await resolveDeviceAddress(
    input.address,
    input.geocoderOverride,
  );
  return saveDeviceAddress(db, {
    deviceId: owned.id,
    principalId: input.principalId,
    address: geocoded,
    unit: input.address.unit ?? null,
  });
}

/** Owner-only read for the device page. */
export async function getDeviceAddressForOwner(
  db: Database,
  input: { deviceId: string; walletId: string },
): Promise<OwnerDeviceAddress | null> {
  const [row] = await db
    .select({ address: deviceAddresses })
    .from(deviceAddresses)
    .innerJoin(devices, eq(devices.id, deviceAddresses.deviceId))
    .where(
      and(eq(devices.id, input.deviceId), eq(devices.walletId, input.walletId)),
    )
    .limit(1);
  return row === undefined ? null : toOwnerView(row.address);
}
