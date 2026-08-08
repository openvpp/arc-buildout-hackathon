export type TelemetryReadingField = {
  readonly label: string;
  readonly value: string;
};

/**
 * Extracts normalized EV telemetry fields from an unlocked delivery payload.
 * Missing / null values render as an em dash — never coerced to zero.
 */
export function readTelemetryReadingFields(
  payload: unknown,
): readonly TelemetryReadingField[] {
  if (typeof payload !== 'object' || payload === null) {
    return EMPTY_FIELDS;
  }
  const record = payload as Record<string, unknown>;
  return [
    {
      label: 'State of charge',
      value: formatPercent(record['stateOfChargePercent']),
    },
    {
      label: 'Battery capacity',
      value: formatKilowattHours(record['batteryCapacityKilowattHours']),
    },
    {
      label: 'Charging',
      value: formatNullableBoolean(record['isCharging']),
    },
    {
      label: 'Plugged in',
      value: formatNullableBoolean(record['isPluggedIn']),
    },
    {
      label: 'Range',
      value: formatKilometers(record['rangeKilometers']),
    },
    {
      label: 'Odometer',
      value: formatKilometers(record['odometerKilometers']),
    },
    {
      label: 'Charge rate',
      value: formatKilowatts(record['chargeRateKilowatts']),
    },
    {
      label: 'Power',
      value: formatKilowatts(record['powerKilowatts']),
    },
  ];
}

const EMPTY_FIELDS: readonly TelemetryReadingField[] = [
  { label: 'State of charge', value: '—' },
  { label: 'Battery capacity', value: '—' },
  { label: 'Charging', value: '—' },
  { label: 'Plugged in', value: '—' },
  { label: 'Range', value: '—' },
  { label: 'Odometer', value: '—' },
  { label: 'Charge rate', value: '—' },
  { label: 'Power', value: '—' },
];

function formatPercent(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${value}%`;
}

function formatNullableBoolean(value: unknown): string {
  if (typeof value !== 'boolean') {
    return '—';
  }
  return value ? 'Yes' : 'No';
}

function formatKilometers(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${value} km`;
}

function formatKilowatts(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${value} kW`;
}

function formatKilowattHours(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return `${value} kWh`;
}
