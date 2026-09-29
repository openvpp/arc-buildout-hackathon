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
 * The globe is always rendered and its data is public — every device with
 * a known location, regardless of who (if anyone) is signed in. Only a
 * genuine fetch failure (not "no pins yet") replaces the map with a
 * message.
 */
export function GlobeView() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function load() {
      try {
        const api = createGlobeApi();
        const locations = await api.listLocations(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setState({ status: 'loaded', locations });
      } catch (e) {
        if (controller.signal.aborted) {
          return;
        }
        const message =
          e instanceof Error ? e.message : 'Failed to load devices';
        setState((current) =>
          current.status === 'loaded' ? current : { status: 'error', message },
        );
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(() => {
            void load();
          }, 60_000);
        }
      }
    }

    void load();
    return () => {
      controller.abort();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
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
