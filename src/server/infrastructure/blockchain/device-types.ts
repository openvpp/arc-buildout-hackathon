/**
 * On-chain device type IDs — source of truth for the `typeId` parameter of
 * the deployed DeviceNFT (ERC-1155) contract's `mintDevice`. This must stay
 * in sync with the contract, not be treated as app-internal config — do not
 * renumber existing entries; only append new ones.
 *
 * This milestone only ever mints `ELECTRIC_VEHICLE` (the only device class
 * Enode Link onboards here — see CLAUDE.md's explicit scope boundary). The
 * rest of the taxonomy is included because it's what the contract itself
 * defines, not because those device classes are onboarded by this app.
 */
export const DEVICE_TYPES = {
  // Vehicles
  ELECTRIC_VEHICLE: 1,
  GAS_VEHICLE: 2,
  HYBRID_VEHICLE: 3,
  PLUGIN_HYBRID: 4,

  // Charging infrastructure
  EV_CHARGER: 5,
  FAST_CHARGER: 6,
  ULTRA_FAST_CHARGER: 7,
  HOME_CHARGER: 8,

  // Smart home / DER devices
  THERMOSTAT: 9,
  SMART_METER: 10,
  SOLAR_INVERTER: 11,
  BATTERY_STORAGE: 12,

  // Industrial
  INDUSTRIAL_EVSE: 13,
  FLEET_MANAGEMENT: 14,
  ENERGY_MANAGEMENT: 15,
} as const;

/**
 * Device classes this app's schema accepts for `devices.device_type`
 * (`devices_device_type_check`). Only `electric_vehicle` is ever actually
 * written by onboarding today; the rest are reserved to match the on-chain
 * taxonomy without implying those flows exist — adding a device class here
 * does not add support for onboarding it.
 */
export const DEVICE_CLASS_TO_TYPE_ID: Record<string, number> = {
  electric_vehicle: DEVICE_TYPES.ELECTRIC_VEHICLE,
  charger: DEVICE_TYPES.EV_CHARGER,
  battery: DEVICE_TYPES.BATTERY_STORAGE,
  solar: DEVICE_TYPES.SOLAR_INVERTER,
  thermostat: DEVICE_TYPES.THERMOSTAT,
};

/**
 * `typeId` for DeviceNFT.mintDevice, resolved from a `devices.device_type`
 * value. Minting is irreversible — fail loudly on an unrecognized class
 * rather than guessing a typeId.
 */
export function getProviderDeviceMintTypeId(deviceType: string): number {
  const typeId = DEVICE_CLASS_TO_TYPE_ID[deviceType.trim()];
  if (typeId === undefined) {
    throw new Error(`Unknown deviceType for on-chain mint: "${deviceType}"`);
  }
  return typeId;
}
