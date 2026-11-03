import { formatUsdcAtomic } from '@/lib/payments/usdc';
import { truncateHash } from '@/features/devices/format';

import { SettlementBadge } from './settlement-badge';

export type UnlockedRecordView = {
  payloadVersion: number;
  record: {
    committed: boolean;
    json: string;
    salt: string | null;
    redactedFields: readonly string[];
  } | null;
  receipt: {
    amountAtomic: bigint;
    payerAddress: string;
    settlementReference: string;
    settlementStatus: string;
    settlementTxHash: string | null;
  };
};

const LABELS: Record<string, string> = {
  startTime: 'Start',
  endTime: 'End',
  startBatteryLevel: 'Start battery (%)',
  endBatteryLevel: 'End battery (%)',
  batteryCapacityKwh: 'Battery capacity (kWh)',
  energyDeliveredKwh: 'Energy delivered (kWh)',
  energyMethod: 'How energy was measured',
  electricityPrice: 'Tariff (per kWh)',
  totalCost: 'Cost',
  currency: 'Currency',
  latitude: 'Latitude',
  longitude: 'Longitude',
  dateUtc: 'Day (UTC)',
  startOdometerKm: 'Start odometer (km)',
  endOdometerKm: 'End odometer (km)',
  startEstimated: 'Start estimated',
  readingCount: 'Readings',
  anomalyCount: 'Anomalies',
  status: 'Status',
};

/** Internal ids and format markers, not worth a row. */
const HIDDEN = new Set([
  'kind',
  'recordVersion',
  'id',
  'deviceId',
  'sessionId',
  'readings',
]);

type Reading = { observedAt: string; odometerKm: string };

function parseRecord(json: string): {
  fields: [string, string][];
  readings: Reading[];
} {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { fields: [], readings: [] };
  }
  if (typeof value !== 'object' || value === null) {
    return { fields: [], readings: [] };
  }
  const record = value as Record<string, unknown>;
  const fields = Object.entries(record)
    .filter(([key, entry]) => !HIDDEN.has(key) && entry !== null)
    .map(([key, entry]): [string, string] => [
      LABELS[key] ?? key,
      String(entry),
    ]);
  const readings = Array.isArray(record['readings'])
    ? record['readings'].flatMap((reading): Reading[] =>
        typeof reading === 'object' &&
        reading !== null &&
        typeof (reading as Reading).observedAt === 'string'
          ? [
              {
                observedAt: (reading as Reading).observedAt,
                odometerKm: String((reading as Reading).odometerKm),
              },
            ]
          : [],
      )
    : [];
  return { fields, readings };
}

/** An unlocked event: its full record, its proof, and what was paid. */
export function UnlockedRecord({
  view,
}: {
  readonly view: UnlockedRecordView;
}) {
  const parsed = view.record === null ? null : parseRecord(view.record.json);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-primary-500/30 bg-primary-500/5 p-3 text-xs">
      {parsed === null ? (
        <p className="text-white/60">
          The full record is no longer available; the published payload above is
          what was anchored.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {parsed.fields.map(([label, value]) => (
              <div key={label}>
                <dt className="font-medium tracking-wide text-white/50 uppercase">
                  {label}
                </dt>
                <dd className="font-mono break-all text-white/90">{value}</dd>
              </div>
            ))}
          </dl>
          {parsed.readings.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-white/60 select-none">
                {parsed.readings.length} odometer reading(s)
              </summary>
              <ul className="mt-2 flex flex-col gap-1 font-mono text-white/80">
                {parsed.readings.map((reading) => (
                  <li key={reading.observedAt}>
                    {reading.observedAt} · {reading.odometerKm} km
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {view.record?.committed === true && view.record.salt !== null ? (
            <details>
              <summary className="cursor-pointer text-white/60 select-none">
                Proof: this record is the one committed on-chain
              </summary>
              <p className="mt-2 text-white/60">
                keccak256(salt + &quot;:&quot; + record) equals the{' '}
                <code>recordHash</code> in the anchored payload. Salt:
              </p>
              <p className="font-mono break-all text-white/80">
                {view.record.salt}
              </p>
            </details>
          ) : view.record?.committed === false ? (
            <p className="text-white/50">
              Published before records were committed on-chain: this is the
              record as stored today.
            </p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-2 text-white/60">
        <span>
          Paid {formatUsdcAtomic(view.receipt.amountAtomic)} USDC by{' '}
          <span className="font-mono">
            {truncateHash(view.receipt.payerAddress)}
          </span>
        </span>
        <SettlementBadge
          status={view.receipt.settlementStatus}
          settlementTxHash={view.receipt.settlementTxHash}
        />
        <span
          className="font-mono"
          title="Circle Gateway transfer id for this payment"
        >
          ref {truncateHash(view.receipt.settlementReference)}
        </span>
      </div>
    </div>
  );
}
