'use client';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useRef, useState } from 'react';

import { env } from '@/config/env';
import { logger } from '@/lib/logger/logger';

import type { DeviceLocation } from './client-api';
import { pinColorForMintStatus } from './pin-style';
import { devicesToGeoJson } from './to-geojson';

const SOURCE_ID = 'devices';
const LAYER_ID = 'device-pins';

export function isMapboxConfigured(): boolean {
  return env.NEXT_PUBLIC_MAPBOX_TOKEN.trim().length > 0;
}

function unavailableMessage(hasToken: boolean): string {
  return hasToken
    ? 'Globe unavailable — the Mapbox token was rejected. Check NEXT_PUBLIC_MAPBOX_TOKEN.'
    : 'Globe unavailable — Mapbox is not configured.';
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
        new mapboxgl.Popup({ closeButton: false, className: 'device-popup' })
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setHTML(
            `<div style="font:13px 'Plus Jakarta Sans',sans-serif;color:#fff"><strong>${String(displayName)}</strong><br/><span style="color:#a3a3a3">${String(vendor)} · <span style="color:${dotColor}">●</span> ${String(mintStatus)}</span><br/><a href="/devices/${id}" style="color:#b7ee65">View device</a></div>`,
          )
          .addTo(map);
        onSelectDeviceRef.current(id);
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
