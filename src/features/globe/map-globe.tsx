'use client';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';

import { env } from '@/config/env';
import { logger } from '@/lib/logger/logger';

import type { DeviceLocation } from './client-api';
import {
  deviceClusterColorExpression,
  deviceGlowColorExpression,
  devicePinExpression,
  devicePinSizeExpression,
  ensureDeviceKindIcons,
  GLOBE_SYMBOL_LIGHTING,
  GLOBE_TEXT_LIGHTING,
} from './device-pin-style';
import { createStyledMapPopup } from './map-popup';
import { pinColorForMintStatus } from './pin-style';
import { DEVICE_CLUSTER_OPTIONS, devicesToGeoJson } from './to-geojson';

const SOURCE_ID = 'devices';
const CLUSTERS_LAYER_ID = 'device-clusters';
const CLUSTER_COUNT_LAYER_ID = 'device-cluster-count';
const GLOW_LAYER_ID = 'device-individual-glow';
const ICONS_LAYER_ID = 'device-icons';
const CLICKABLE_LAYER_ID = 'device-clickable';

export function isMapboxConfigured(): boolean {
  return env.NEXT_PUBLIC_MAPBOX_TOKEN.trim().length > 0;
}

function unavailableMessage(hasToken: boolean): string {
  return hasToken
    ? 'Globe unavailable — the Mapbox token was rejected. Check NEXT_PUBLIC_MAPBOX_TOKEN.'
    : 'Globe unavailable — Mapbox is not configured.';
}

function deviceTypeLabel(deviceType: string): string {
  return deviceType.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Renders devices as pins on a Mapbox globe, using the same teardrop
 * marker design and clustering behavior as openvpp-app's fleet map
 * (see device-pin-style.ts, ported from its `deviceKindStyle`/`EVLayer`).
 * Devices without coordinates are simply not in `devices` (see
 * list-device-locations.ts) — no fallback pin. Imperative mapbox-gl
 * lifecycle requires useEffect; this is a third-party DOM library, not app
 * state.
 */
export function MapGlobe({
  devices,
  onSelectDevice,
  heightClassName = 'h-[100dvh]',
}: {
  devices: DeviceLocation[];
  onSelectDevice: (deviceId: string) => void;
  heightClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectDeviceRef = useRef(onSelectDevice);
  onSelectDeviceRef.current = onSelectDevice;
  const [hasLoadError, setHasLoadError] = useState(false);
  const configured = isMapboxConfigured();

  useEffect(() => {
    if (
      !configured ||
      containerRef.current === null ||
      mapRef.current !== null
    ) {
      return;
    }
    mapboxgl.accessToken = env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: { name: 'globe' },
      center: [0, 20],
      zoom: 1.2,
      attributionControl: false,
    });
    mapRef.current = map;

    // A bad/expired token fails here (401) rather than throwing — surface it
    // as a clear message instead of leaving a blank canvas on screen.
    map.on('error', (event) => {
      logger.error('globe.mapbox_error', {
        message: event.error?.message ?? 'unknown mapbox error',
      });
      setHasLoadError(true);
    });

    map.on('style.load', () => {
      // Near-black space/horizon so the globe blends into the page instead
      // of reading as a lighter box floating on a darker page.
      map.setFog({
        color: '#0a0a0a',
        'high-color': '#0a0a0a',
        'space-color': '#000000',
        'horizon-blend': 0.05,
        'star-intensity': 0.1,
      });
    });

    map.on('load', () => {
      ensureDeviceKindIcons(map);

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: devicesToGeoJson([]),
        ...DEVICE_CLUSTER_OPTIONS,
      });

      // Layer add-order is z-order (later = on top): cluster bubble, its
      // count label, then per-pin glow, icon, and an invisible larger
      // click target — same stack as openvpp-app's EVLayer.
      map.addLayer({
        id: CLUSTERS_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': deviceClusterColorExpression(),
          'circle-radius': 12,
          'circle-opacity': 1.0,
          'circle-stroke-width': 0,
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['to-string', ['get', 'point_count']],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 12,
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#000000',
          'text-halo-color': 'transparent',
          'text-halo-width': 0,
          ...GLOBE_TEXT_LIGHTING,
        },
      });

      map.addLayer({
        id: GLOW_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': deviceGlowColorExpression(),
          'circle-radius': 6,
          'circle-opacity': 1.0,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addLayer({
        id: ICONS_LAYER_ID,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': devicePinExpression(),
          'icon-size': devicePinSizeExpression(),
          'icon-anchor': 'center',
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
        paint: {
          ...GLOBE_SYMBOL_LIGHTING,
        },
      });

      map.addLayer({
        id: CLICKABLE_LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 15,
          'circle-opacity': 0,
        },
      });

      const handleClusterClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (feature?.geometry.type !== 'Point') {
          return;
        }
        const clusterId = feature.properties?.['cluster_id'];
        const coordinates = feature.geometry.coordinates as [number, number];
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err || zoom === null || zoom === undefined) {
            return;
          }
          map.easeTo({
            center: coordinates,
            zoom,
            duration: 1000,
          });
        });
      };

      const handleDeviceClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.['id'];
        const displayName = feature?.properties?.['displayName'];
        const vendor = feature?.properties?.['vendor'];
        const deviceType = feature?.properties?.['deviceType'];
        const mintStatus = feature?.properties?.['mintStatus'];
        if (typeof id !== 'string' || feature?.geometry.type !== 'Point') {
          return;
        }
        createStyledMapPopup({
          map,
          coordinates: feature.geometry.coordinates as [number, number],
          title: String(displayName),
          subtitle: String(vendor),
          fields: [
            { label: 'Type', value: deviceTypeLabel(String(deviceType)) },
            {
              label: 'Status',
              value: String(mintStatus),
              valueColor: pinColorForMintStatus(String(mintStatus)),
            },
          ],
          linkHref: `/devices/${id}`,
          linkLabel: 'View device',
        });
        onSelectDeviceRef.current(id);
      };

      const handleMouseEnter = () => {
        map.getCanvas().style.cursor = 'pointer';
      };
      const handleMouseLeave = () => {
        map.getCanvas().style.cursor = '';
      };

      map.on('click', CLUSTERS_LAYER_ID, handleClusterClick);
      map.on('click', CLICKABLE_LAYER_ID, handleDeviceClick);
      [CLUSTERS_LAYER_ID, CLICKABLE_LAYER_ID].forEach((layerId) => {
        map.on('mouseenter', layerId, handleMouseEnter);
        map.on('mouseleave', layerId, handleMouseLeave);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [configured]);

  useEffect(() => {
    const map = mapRef.current;
    if (map === null) {
      return;
    }
    const applyData = () => {
      const source = map.getSource(SOURCE_ID) as
        mapboxgl.GeoJSONSource | undefined;
      source?.setData(devicesToGeoJson(devices));
    };
    if (map.isStyleLoaded() && map.getSource(SOURCE_ID) !== undefined) {
      applyData();
    } else {
      map.once('load', applyData);
    }
  }, [devices]);

  if (!configured || hasLoadError) {
    return (
      <div
        className={`flex w-full items-center justify-center bg-background px-6 text-center text-sm text-white/50 ${heightClassName}`}
      >
        {unavailableMessage(configured)}
      </div>
    );
  }

  return <div ref={containerRef} className={`w-full ${heightClassName}`} />;
}
