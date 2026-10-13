import type { FeatureCollection, Point } from 'geojson';

import type { DeviceLocation } from './client-api';
import { deviceTypeClusterProperties } from './device-pin-style';

export type DevicePinProperties = {
  id: string;
  displayName: string;
  vendor: string;
  deviceType: string;
  mintStatus: string;
  locationSource: 'address' | 'live';
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
        displayName:
          device.displayName ??
          ([device.vendor, device.model]
            .filter((part): part is string => part !== null)
            .join(' ') ||
            'Vehicle'),
        vendor: device.vendor ?? 'Unknown vendor',
        deviceType: device.deviceType,
        mintStatus: device.mintStatus,
        locationSource: device.locationSource,
      },
    })),
  };
}

export const DEVICE_CLUSTER_OPTIONS = {
  cluster: true,
  clusterRadius: 50,
  clusterMaxZoom: 12,
  clusterMinPoints: 2,
  clusterProperties: deviceTypeClusterProperties(),
} as const;
