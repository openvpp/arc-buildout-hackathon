/**
 * Maps one OVPP Mongo `vehicles` document onto a row this app can store.
 *
 * The backup contains encrypted Smartcar tokens (`tokenEnc`). This mapper
 * never reads that field. Historical Arc token ids are kept under `legacy*`
 * metadata keys only: those transactions are not on this app's DeviceNFT
 * contract, so mint columns stay empty and `mint_status` stays `unminted`.
 */

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH = /^0x[a-fA-F0-9]{64}$/;

export type LegacyDeviceStatus = 'active' | 'inactive' | 'disconnected';
export type LegacyDeviceProvider = 'smartcar' | 'enode';

export type MappedOvppVehicle = {
  vehicleId: string;
  ownerAddress: string;
  provider: LegacyDeviceProvider;
  vendor: string | null;
  model: string | null;
  displayName: string;
  status: LegacyDeviceStatus;
  metadata: Record<string, unknown>;
  latitude: string | null;
  longitude: string | null;
  lastLocationAt: Date | null;
  lastSeenAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type MapOvppVehicleResult =
  | { ok: true; vehicle: MappedOvppVehicle }
  | {
      ok: false;
      reason: 'not_object' | 'missing_vehicle_id' | 'invalid_owner_address';
    };

export function mapOvppVehicle(input: unknown): MapOvppVehicleResult {
  if (!isRecord(input)) {
    return { ok: false, reason: 'not_object' };
  }

  const vehicleId = readText(input.vehicleId, 200);
  if (vehicleId === null) {
    return { ok: false, reason: 'missing_vehicle_id' };
  }

  const ownerAddress = readText(input.userId, 42);
  if (ownerAddress === null || !EVM_ADDRESS.test(ownerAddress)) {
    return { ok: false, reason: 'invalid_owner_address' };
  }

  const attrs = isRecord(input.attrs) ? input.attrs : {};
  const vendor = readText(attrs.make, 80);
  const model = readText(attrs.model, 80);
  const displayName =
    readText(input.deviceName, 200) ?? joinName(vendor, model) ?? vehicleId;

  const location = readLocation(input.location);
  const lastSeenAt =
    parseMongoDate(input.lastConnectedAt) ??
    location?.at ??
    parseMongoDate(input.updatedAt);

  return {
    ok: true,
    vehicle: {
      vehicleId,
      ownerAddress: ownerAddress.toLowerCase(),
      provider: input.provider === 'enode' ? 'enode' : 'smartcar',
      vendor,
      model,
      displayName,
      status: mapStatus(input),
      metadata: buildMetadata(input, attrs),
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      lastLocationAt: location?.at ?? null,
      lastSeenAt,
      createdAt: parseMongoDate(input.createdAt),
      updatedAt: parseMongoDate(input.updatedAt),
    },
  };
}

function mapStatus(doc: Record<string, unknown>): LegacyDeviceStatus {
  if (doc.smartcarConnectionStatus === 'revoked') {
    return 'disconnected';
  }
  if (doc.status === 'disabled' || doc.isActive === false) {
    return 'inactive';
  }
  return 'active';
}

function buildMetadata(
  doc: Record<string, unknown>,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    legacySource: 'ovpp-vehicles',
  };
  if (
    typeof attrs.year === 'number' &&
    Number.isInteger(attrs.year) &&
    attrs.year >= 1980 &&
    attrs.year <= 2100
  ) {
    metadata.year = attrs.year;
  }
  const fuelType = readText(doc.fuelType, 32);
  if (fuelType !== null) {
    metadata.fuelType = fuelType;
  }
  const arcMintStatus = readText(doc.arcMintStatus, 32);
  if (arcMintStatus !== null) {
    metadata.legacyArcMintStatus = arcMintStatus;
  }
  if (
    typeof doc.arcNftTokenId === 'number' &&
    Number.isFinite(doc.arcNftTokenId)
  ) {
    metadata.legacyArcNftTokenId = String(doc.arcNftTokenId);
  } else {
    const arcToken = readText(doc.arcNftTokenId, 40);
    if (arcToken !== null) {
      metadata.legacyArcNftTokenId = arcToken;
    }
  }
  const arcTx = readText(doc.arcOnchainTxHash, 66);
  if (arcTx !== null && TX_HASH.test(arcTx)) {
    metadata.legacyArcTxHash = arcTx;
  }
  return metadata;
}

function readLocation(value: unknown): {
  latitude: string;
  longitude: string;
  at: Date | null;
} | null {
  if (!isRecord(value)) {
    return null;
  }
  const latitude = readCoordinate(value.latitude, 90);
  const longitude = readCoordinate(value.longitude, 180);
  if (latitude === null || longitude === null) {
    return null;
  }
  return {
    latitude,
    longitude,
    at: parseMongoDate(value.lastUpdated),
  };
}

function readCoordinate(value: unknown, maxAbs: number): string | null {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric) || Math.abs(numeric) > maxAbs) {
    return null;
  }
  return numeric.toFixed(6);
}

export function parseMongoDate(value: unknown): Date | null {
  const raw = isRecord(value) && '$date' in value ? value.$date : value;
  if (typeof raw === 'string' || typeof raw === 'number') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function joinName(vendor: string | null, model: string | null): string | null {
  const name = [vendor, model].filter((part) => part !== null).join(' ');
  return name.length > 0 ? name : null;
}

function readText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
