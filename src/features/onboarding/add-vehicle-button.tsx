'use client';

import { useDeviceOnboardModal } from './device-onboard-modal-provider';

/** Opens the "Add vehicle" popup (see DeviceOnboardModal) — used on pages that need the trigger inline, outside the header dropdown. */
export function AddVehicleButton({ className }: { className: string }) {
  const openDeviceOnboardModal = useDeviceOnboardModal();

  return (
    <button
      type="button"
      onClick={openDeviceOnboardModal}
      className={className}
    >
      Add vehicle
    </button>
  );
}
