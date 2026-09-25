import type { FeatureCollection, Point } from 'geojson';

import type { DeviceLocation } from './client-api';

export type DevicePinProperties = {
  id: string;
  displayName: string;
  vendor: string;
  mintStatus: string;
};

export function devicesToGeoJson(
  devices: DeviceLocation[],
): FeatureCollection<Point, DevicePinProperties> {
  return {
    type: 'FeatureCollection',
    features: devices.map((device) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [device.longitude, device.latitude],
      },
      properties: {
        id: device.id,
        displayName: device.displayName ?? device.externalDeviceId,
        vendor: device.vendor ?? 'Unknown vendor',
        mintStatus: device.mintStatus,
      },
    })),
  };
}
