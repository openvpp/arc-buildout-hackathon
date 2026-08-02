import { createHash } from 'node:crypto';

import {
  TELEMETRY_CANONICALIZATION_VERSION,
  TELEMETRY_HASH_ALGORITHM,
  TELEMETRY_SCHEMA_VERSION,
} from '@/server/config/constants';

/**
 * Provider-independent EV telemetry payload sold to agents.
 * Missing provider fields stay null — never coerced to zero.
 */
export type NormalizedTelemetryData = {
  readonly stateOfChargePercent: number | null;
  readonly isCharging: boolean | null;
  readonly isPluggedIn: boolean | null;
  readonly rangeKilometers: number | null;
  readonly odometerKilometers: number | null;
  readonly chargeRateKilowatts: number | null;
  readonly powerKilowatts: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
};

export type CanonicalTelemetryDocument = {
  readonly canonicalizationVersion: string;
  readonly schemaVersion: string;
  readonly deviceId: string;
  readonly source: string;
  readonly sourceObservedAt: string | null;
  readonly recordedAt: string;
  readonly receivedAt: string;
  readonly data: NormalizedTelemetryData;
};

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeysDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

export function buildCanonicalTelemetryDocument(input: {
  deviceId: string;
  source: string;
  sourceObservedAt: Date | null;
  recordedAt: Date;
  receivedAt: Date;
  data: NormalizedTelemetryData;
}): CanonicalTelemetryDocument {
  return {
    canonicalizationVersion: TELEMETRY_CANONICALIZATION_VERSION,
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    deviceId: input.deviceId,
    source: input.source,
    sourceObservedAt: input.sourceObservedAt?.toISOString() ?? null,
    recordedAt: input.recordedAt.toISOString(),
    receivedAt: input.receivedAt.toISOString(),
    data: input.data,
  };
}

/** Deterministic canonical JSON (sorted keys, UTC ISO timestamps already). */
export function canonicalizeTelemetry(
  document: CanonicalTelemetryDocument,
): string {
  return `${JSON.stringify(sortKeysDeep(document))}`;
}

export function hashCanonicalTelemetry(canonicalJson: string): {
  algorithm: typeof TELEMETRY_HASH_ALGORITHM;
  contentHash: string;
} {
  const contentHash = createHash('sha256')
    .update(canonicalJson, 'utf8')
    .digest('hex');
  return { algorithm: TELEMETRY_HASH_ALGORITHM, contentHash };
}
