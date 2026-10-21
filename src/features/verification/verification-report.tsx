import { StatusBadge } from '@/components/ui/status-badge';
import { TransactionLink } from '@/features/devices/transaction-link';

import {
  CHECK_LABELS,
  toVerdictValue,
  verdictLabel,
  verdictTone,
} from './verdict';

export type ReportCheck = { id: string; status: string; detail: string };

export type VerificationReportProps = {
  verdict: string | null;
  checks: ReportCheck[];
  checkedAt: string | null;
  checkedBy: string | null;
  transactionHash: string | null;
  blockNumber: string | null;
  payloadJson: string;
  payloadHash: string;
  payloadVersion: number;
  /** Shown to admins only: the private record behind recordHash. */
  privateRecord?: { recordJson: string; recordSalt: string } | null;
  reproduceCommand?: string;
};

const STATUS_MARK: Record<string, { mark: string; className: string }> = {
  pass: { mark: '✓', className: 'text-primary-400' },
  fail: { mark: '✕', className: 'text-red-400' },
  warn: { mark: '!', className: 'text-amber-400' },
  pending: { mark: '…', className: 'text-amber-400' },
  skip: { mark: '–', className: 'text-white/40' },
};

export function VerdictBadge({ verdict }: { verdict: string | null }) {
  const value = toVerdictValue(verdict ?? 'unchecked');
  return (
    <StatusBadge tone={verdictTone(value)}>{verdictLabel(value)}</StatusBadge>
  );
}

/**
 * The full evidence for one record: verdict, every check and why, the
 * anchor, the exact published bytes and their hash, and how to repeat the
 * check independently.
 */
export function VerificationReport(props: VerificationReportProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <VerdictBadge verdict={props.verdict} />
        <TransactionLink transactionHash={props.transactionHash} />
        {props.blockNumber !== null ? (
          <span className="text-xs text-white/60">
            block {props.blockNumber}
          </span>
        ) : null}
        <span className="text-xs text-white/60">
          payload v{props.payloadVersion}
        </span>
      </div>

      {props.checks.length > 0 ? (
        <ul className="flex flex-col divide-y divide-white/10 rounded-md border border-white/10">
          {props.checks.map((check) => {
            const mark = STATUS_MARK[check.status] ?? STATUS_MARK['skip'];
            return (
              <li key={check.id} className="flex gap-3 px-3 py-2 text-sm">
                <span
                  aria-label={check.status}
                  className={`w-4 shrink-0 text-center font-bold ${mark?.className ?? ''}`}
                >
                  {mark?.mark}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-white/90">
                    {CHECK_LABELS[check.id] ?? check.id}
                  </span>
                  <span className="text-xs break-words text-white/60">
                    {check.detail}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-white/60">No verification has run yet.</p>
      )}

      {props.checkedAt !== null ? (
        <p className="text-xs text-white/50">
          Last checked {new Date(props.checkedAt).toUTCString()}
          {props.checkedBy !== null ? ` by ${props.checkedBy}` : ''}.
        </p>
      ) : null}

      <details className="text-xs text-white/60">
        <summary className="cursor-pointer select-none">
          Published payload (exact on-chain bytes)
        </summary>
        <dl className="mt-2 flex flex-col gap-2">
          <div>
            <dt className="font-medium tracking-wide uppercase">Payload</dt>
            <dd className="font-mono break-all text-white/80">
              {props.payloadJson}
            </dd>
          </div>
          <div>
            <dt className="font-medium tracking-wide uppercase">keccak256</dt>
            <dd className="font-mono break-all text-white/80">
              {props.payloadHash}
            </dd>
          </div>
        </dl>
      </details>

      {props.privateRecord !== undefined && props.privateRecord !== null ? (
        <details className="text-xs text-white/60">
          <summary className="cursor-pointer select-none">
            Private record and salt (admin only)
          </summary>
          <dl className="mt-2 flex flex-col gap-2">
            <div>
              <dt className="font-medium tracking-wide uppercase">Record</dt>
              <dd className="font-mono break-all text-white/80">
                {props.privateRecord.recordJson}
              </dd>
            </div>
            <div>
              <dt className="font-medium tracking-wide uppercase">Salt</dt>
              <dd className="font-mono break-all text-white/80">
                {props.privateRecord.recordSalt}
              </dd>
            </div>
          </dl>
        </details>
      ) : null}

      {props.reproduceCommand !== undefined ? (
        <details className="text-xs text-white/60">
          <summary className="cursor-pointer select-none">
            Verify it yourself (no trust in this site)
          </summary>
          <pre className="mt-2 overflow-x-auto rounded-md bg-black/60 p-3 font-mono text-white/80">
            {props.reproduceCommand}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
