'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';

import { createGlobeApi, type DeviceLocation } from './client-api';
import { MapGlobe } from './map-globe';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; locations: DeviceLocation[] };

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

  if (state.status === 'loading') {
    return (
      <div className="h-[calc(100vh-8rem)] animate-pulse rounded-lg bg-slate-100" />
    );
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-red-600">
        {state.message}
      </p>
    );
  }
  if (state.locations.length === 0) {
    return (
      <EmptyState
        title="No devices with a known location yet"
        description="Devices show up here once Enode reports a location for them."
      />
    );
  }

  return (
    <MapGlobe
      devices={state.locations}
      heightClassName="h-[calc(100vh-8rem)]"
      onSelectDevice={(deviceId) => {
        router.prefetch(`/devices/${deviceId}`);
      }}
    />
  );
}
