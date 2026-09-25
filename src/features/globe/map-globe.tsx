'use client';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef } from 'react';

import { env } from '@/config/env';

import type { DeviceLocation } from './client-api';
import { pinColorForMintStatus } from './pin-style';
import { devicesToGeoJson } from './to-geojson';

const SOURCE_ID = 'devices';
const LAYER_ID = 'device-pins';

export function isMapboxConfigured(): boolean {
  return env.NEXT_PUBLIC_MAPBOX_TOKEN.trim().length > 0;
}

/**
 * Renders devices as pins on a Mapbox globe. Devices without coordinates
 * are simply not in `devices` (see list-device-locations.ts) — no fallback
 * pin is shown for them. Imperative mapbox-gl lifecycle requires useEffect;
 * this is a third-party DOM library, not app state.
 */
export function MapGlobe({
  devices,
  onSelectDevice,
}: {
  devices: DeviceLocation[];
  onSelectDevice: (deviceId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const onSelectDeviceRef = useRef(onSelectDevice);
  onSelectDeviceRef.current = onSelectDevice;

  useEffect(() => {
    if (containerRef.current === null || mapRef.current !== null) {
      return;
    }
    mapboxgl.accessToken = env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      projection: { name: 'globe' },
      center: [0, 20],
      zoom: 1.2,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('style.load', () => {
      map.setFog({});
    });

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: devicesToGeoJson([]),
      });
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': 7,
          // Mirrors pinColorForMintStatus — GL style expressions can't call
          // JS, so the palette is necessarily duplicated here.
          'circle-color': [
            'match',
            ['get', 'mintStatus'],
            'minted',
            '#10b981',
            'pending',
            '#f59e0b',
            'failed',
            '#ef4444',
            '#94a3b8',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#0f172a',
        },
      });

      map.on('mouseenter', LAYER_ID, () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('click', LAYER_ID, (event) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.['id'];
        const displayName = feature?.properties?.['displayName'];
        const vendor = feature?.properties?.['vendor'];
        const mintStatus = feature?.properties?.['mintStatus'];
        if (typeof id !== 'string' || feature?.geometry.type !== 'Point') {
          return;
        }
        const dotColor = pinColorForMintStatus(String(mintStatus));
        new mapboxgl.Popup({ closeButton: false })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font:13px sans-serif;color:#0f172a"><strong>${String(displayName)}</strong><br/>${String(vendor)} · <span style="color:${dotColor}">●</span> ${String(mintStatus)}<br/><a href="/devices/${id}" style="color:#2563eb">View device</a></div>`,
          )
          .addTo(map);
        onSelectDeviceRef.current(id);
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

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

  if (!isMapboxConfigured()) {
    return (
      <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">
        Globe unavailable — Mapbox is not configured.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-96 w-full overflow-hidden rounded-lg border border-slate-200"
    />
  );
}
