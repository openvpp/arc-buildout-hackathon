export type MappedEnodeVehicle = {
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  displayName?: string;
  latitude: number | null;
  longitude: number | null;
};

function pickId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw['id'] === 'string' && raw['id'].length > 0) {
    return raw['id'];
  }
  return undefined;
}

function pickLocation(raw: Record<string, unknown>): {
  latitude: number | null;
  longitude: number | null;
} {
  const location =
    raw['location'] !== undefined && typeof raw['location'] === 'object'
      ? (raw['location'] as Record<string, unknown>)
      : {};
  const latitude =
    typeof location['latitude'] === 'number' ? location['latitude'] : null;
  const longitude =
    typeof location['longitude'] === 'number' ? location['longitude'] : null;
  return { latitude, longitude };
}

export function mapEnodeVehicle(raw: unknown): MappedEnodeVehicle | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const v = raw as Record<string, unknown>;
  const vehicleId = pickId(v);
  if (vehicleId === undefined) {
    return null;
  }

  const info =
    v['information'] !== undefined && typeof v['information'] === 'object'
      ? (v['information'] as Record<string, unknown>)
      : {};

  const make = String(
    (typeof info['brand'] === 'string' && info['brand']) ||
      (typeof info['make'] === 'string' && info['make']) ||
      'Unknown',
  ).trim();
  const model = String(
    (typeof info['model'] === 'string' && info['model']) || 'Vehicle',
  ).trim();
  const year =
    typeof info['year'] === 'number' ? info['year'] : new Date().getFullYear();
  const displayNameRaw =
    (typeof v['nickname'] === 'string' && v['nickname']) ||
    `${make} ${model}`.trim();
  const { latitude, longitude } = pickLocation(v);

  return {
    vehicleId,
    make,
    model,
    year,
    displayName: displayNameRaw.length > 0 ? displayNameRaw : vehicleId,
    latitude,
    longitude,
  };
}

function normalizeBrandToken(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '_');
}

function rowBrandTokens(row: Record<string, unknown>): string[] {
  const info =
    row['information'] !== undefined && typeof row['information'] === 'object'
      ? (row['information'] as Record<string, unknown>)
      : {};
  return [info['brand'], info['make']]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(normalizeBrandToken);
}

/** Pick the vehicle matching `normalizedBrand` from an Enode vehicle list, or the first one. */
export function pickEnodeVehicleIdFromList(
  list: unknown,
  normalizedBrand?: string,
): string | undefined {
  if (!Array.isArray(list) || list.length === 0) {
    return undefined;
  }
  if (normalizedBrand !== undefined && normalizedBrand.trim().length > 0) {
    const want = normalizeBrandToken(normalizedBrand);
    const matched = list.find(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        rowBrandTokens(item as Record<string, unknown>).some((t) => t === want),
    );
    if (matched !== undefined && typeof matched === 'object') {
      const id = pickId(matched as Record<string, unknown>);
      if (id !== undefined) {
        return id;
      }
    }
  }
  const first = list[0];
  return first !== null && typeof first === 'object'
    ? pickId(first as Record<string, unknown>)
    : undefined;
}
