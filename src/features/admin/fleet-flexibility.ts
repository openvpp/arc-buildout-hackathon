import {
  computeChargeHeadroom,
  sumChargeHeadroomKilowattHours,
  type ChargeHeadroomResult,
} from '@/server/domain/telemetry/fleet-headroom';

export type FleetFlexibilityVehicle = {
  readonly deviceId: string;
  readonly label: string;
  readonly walletLabel: string;
  readonly stateOfChargePercent: number | null;
  readonly batteryCapacityKilowattHours: number | null;
  readonly headroom: ChargeHeadroomResult;
  readonly hasVerifiedReading: boolean;
};

export type FleetFlexibilitySummary = {
  readonly vehicles: readonly FleetFlexibilityVehicle[];
  readonly totalHeadroomKilowattHours: number;
  readonly includedVehicleCount: number;
  readonly verifiedVehicleCount: number;
};

function readNumberField(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  if (payload === null || payload === undefined) {
    return null;
  }
  const value = payload[key];
  return typeof value === 'number' && !Number.isNaN(value) ? value : null;
}

function asPayload(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return null;
}

/**
 * Builds fleet charge-flexibility summary from admin snapshot devices.
 * Prefers each device's latest independently VERIFIED telemetry payload;
 * falls back to the latest unlocked telemetry when no verified reading exists.
 */
export function summarizeFleetFlexibility(
  snapshot: readonly {
    readonly wallet: {
      readonly label: string | null;
      readonly address: string;
    };
    readonly devices: readonly {
      readonly device: {
        readonly id: string;
        readonly displayName: string | null;
        readonly vendor: string | null;
        readonly model: string | null;
        readonly externalDeviceId: string;
      };
      readonly latest?: {
        readonly telemetryPayload: unknown;
      } | null;
      readonly latestVerified: {
        readonly telemetryPayload: unknown;
      } | null;
    }[];
  }[],
  deviceDisplayName: (device: {
    readonly displayName: string | null;
    readonly vendor: string | null;
    readonly model: string | null;
    readonly externalDeviceId: string;
  }) => string,
  shortenAddress: (address: string) => string,
): FleetFlexibilitySummary {
  const vehicles: FleetFlexibilityVehicle[] = [];

  for (const row of snapshot) {
    const walletLabel = row.wallet.label ?? shortenAddress(row.wallet.address);
    for (const entry of row.devices) {
      const hasVerifiedReading = entry.latestVerified !== null;
      const payload =
        asPayload(entry.latestVerified?.telemetryPayload) ??
        asPayload(entry.latest?.telemetryPayload);
      const stateOfChargePercent = readNumberField(
        payload,
        'stateOfChargePercent',
      );
      const batteryCapacityKilowattHours = readNumberField(
        payload,
        'batteryCapacityKilowattHours',
      );
      const headroom = computeChargeHeadroom({
        stateOfChargePercent,
        batteryCapacityKilowattHours,
      });

      vehicles.push({
        deviceId: entry.device.id,
        label: deviceDisplayName(entry.device),
        walletLabel,
        stateOfChargePercent,
        batteryCapacityKilowattHours,
        headroom,
        hasVerifiedReading,
      });
    }
  }

  const included = vehicles.filter((v) => v.headroom.ok);
  return {
    vehicles,
    totalHeadroomKilowattHours: sumChargeHeadroomKilowattHours(
      included.map((v) => v.headroom),
    ),
    includedVehicleCount: included.length,
    verifiedVehicleCount: vehicles.filter((v) => v.hasVerifiedReading).length,
  };
}

export function formatKilowattHours(value: number): string {
  return `${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })} kWh`;
}
