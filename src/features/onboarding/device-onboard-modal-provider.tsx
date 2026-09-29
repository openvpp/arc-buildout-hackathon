'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createOnboardingApi } from './client-api';
import { DeviceOnboardModal } from './device-onboard-modal';

const DeviceOnboardModalContext = createContext<(() => void) | null>(null);

/** Opens the "Add vehicle" popup (see DeviceOnboardModal) from anywhere under DeviceOnboardModalProvider. */
export function useDeviceOnboardModal(): () => void {
  const openModal = useContext(DeviceOnboardModalContext);
  if (openModal === null) {
    throw new Error(
      'useDeviceOnboardModal must be used within DeviceOnboardModalProvider',
    );
  }
  return openModal;
}

/**
 * Hosts the single "Add vehicle" popup instance for the dashboard, so the
 * header wallet dropdown and the devices page can both trigger it without
 * navigating to a dedicated screen.
 */
export function DeviceOnboardModalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const openModal = useCallback(() => {
    setError(null);
    setOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    if (isSubmitting) {
      return;
    }
    setOpen(false);
  }, [isSubmitting]);

  const submit = useCallback((brand: string) => {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setError(null);
    setIsSubmitting(true);
    void (async () => {
      try {
        const api = createOnboardingApi();
        const data = await api.startLink(
          brand.trim().length > 0 ? { brand: brand.trim() } : {},
        );
        window.location.href = data.linkUrl;
      } catch (e) {
        inFlight.current = false;
        setIsSubmitting(false);
        setError(e instanceof Error ? e.message : 'Unexpected error');
      }
    })();
  }, []);

  return (
    <DeviceOnboardModalContext.Provider value={openModal}>
      {children}
      <DeviceOnboardModal
        open={open}
        isSubmitting={isSubmitting}
        error={error}
        onClose={closeModal}
        onSubmit={submit}
      />
    </DeviceOnboardModalContext.Provider>
  );
}
