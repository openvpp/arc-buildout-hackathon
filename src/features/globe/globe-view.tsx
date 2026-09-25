'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { createGlobeApi, type DeviceLocation } from './client-api';
import { MapGlobe } from './map-globe';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; locations: DeviceLocation[] };

/**
 * The globe is always rendered — signed out, signed in with zero devices,
 * and signed in with devices are all just different pin counts on the same
 * map, never a different screen. Only a genuine fetch failure (not "no
 * pins yet") replaces the map with a message.
 */
export function GlobeView() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const api = createGlobeApi();
        const locations = await api.listLocations();
        if (!controller.signal.aborted) {
          setState({ status: 'loaded', locations });
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setState({
            status: 'error',
            message: e instanceof Error ? e.message : 'Failed to load devices',
          });
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);

  if (state.status === 'error') {
    return (
      <div className="flex h-[100dvh] items-center justify-center px-6">
        <p role="alert" className="text-sm text-red-400">
          {state.message}
        </p>
      </div>
    );
  }

  return (
    <MapGlobe
      devices={state.status === 'loaded' ? state.locations : []}
      onSelectDevice={(deviceId) => {
        router.prefetch(`/devices/${deviceId}`);
      }}
    />
  );
}
