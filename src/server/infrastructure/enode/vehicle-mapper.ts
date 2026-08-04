export type MappedEnodeVehicle = {
  vehicleId: string;
  make: string;
  model: string;
  year: number;
  displayName?: string;
};

function pickId(raw: Record<string, unknown>): string | undefined {
  if (typeof raw['id'] === 'string' && raw['id'].length > 0) {
    return raw['id'];
  }
  if (typeof raw['vehicleId'] === 'string' && raw['vehicleId'].length > 0) {
    return raw['vehicleId'];
  }
  return undefined;
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

  const makeRaw =
    (typeof info['brand'] === 'string' && info['brand']) ||
    (typeof info['make'] === 'string' && info['make']) ||
    (typeof v['make'] === 'string' && v['make']) ||
    (typeof v['vendor'] === 'string' && v['vendor']) ||
    (typeof v['brand'] === 'string' && v['brand']) ||
    '';
  const modelRaw =
    (typeof info['model'] === 'string' && info['model']) ||
    (typeof v['model'] === 'string' && v['model']) ||
    '';
  const make = String(makeRaw).trim() || 'Unknown';
  const model = String(modelRaw).trim() || 'Vehicle';
  const year =
    typeof info['year'] === 'number'
      ? info['year']
      : typeof v['year'] === 'number'
        ? v['year']
        : new Date().getFullYear();

  const displayNameRaw =
    (typeof v['nickname'] === 'string' && v['nickname']) ||
    (typeof info['displayName'] === 'string' && info['displayName']) ||
    `${make} ${model}`.trim() ||
    vehicleId;
  const displayName = String(displayNameRaw).trim();

  return {
    vehicleId,
    make,
    model,
    year,
    ...(displayName.length > 0 ? { displayName } : {}),
  };
}

function normalizeBrand(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '_');
}

function rowBrandTokens(row: Record<string, unknown>): string[] {
  const info =
    row['information'] !== undefined && typeof row['information'] === 'object'
      ? (row['information'] as Record<string, unknown>)
      : {};
  const raw = [
    info['brand'],
    info['make'],
    row['brand'],
    row['vendor'],
    row['make'],
  ];
  return raw
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => normalizeBrand(v));
}

export function pickEnodeVehicleIdFromList(
  list: unknown,
  normalizedBrand?: string,
): string | undefined {
  if (!Array.isArray(list) || list.length === 0) {
    return undefined;
  }
  const items: unknown[] = list;
  if (normalizedBrand !== undefined && normalizedBrand.trim().length > 0) {
    const want = normalizeBrand(normalizedBrand);
    const matched: unknown = items.find((item) => {
      if (item === null || typeof item !== 'object') {
        return false;
      }
      return rowBrandTokens(item as Record<string, unknown>).some(
        (t) => t === want || t.includes(want) || want.includes(t),
      );
    });
    if (matched !== undefined && typeof matched === 'object') {
      const id = pickId(matched as Record<string, unknown>);
      if (id !== undefined) {
        return id;
      }
    }
  }
  const first: unknown = items[0];
  if (first !== null && typeof first === 'object') {
    return pickId(first as Record<string, unknown>);
  }
  return undefined;
}
