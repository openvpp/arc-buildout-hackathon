/** Display mapping for verification verdicts (shared by public + admin UI). */
export type VerdictValue =
  | 'unchecked'
  | 'pending'
  | 'verified'
  | 'verified_with_warnings'
  | 'unverified';

export type VerdictTone = 'neutral' | 'success' | 'warning' | 'danger';

export function verdictLabel(verdict: VerdictValue): string {
  switch (verdict) {
    case 'verified':
      return 'Verified';
    case 'verified_with_warnings':
      return 'Verified · warnings';
    case 'unverified':
      return 'Unverified';
    case 'pending':
      return 'Verification pending';
    case 'unchecked':
      return 'Not yet verified';
  }
}

export function verdictTone(verdict: VerdictValue): VerdictTone {
  switch (verdict) {
    case 'verified':
      return 'success';
    case 'verified_with_warnings':
    case 'pending':
      return 'warning';
    case 'unverified':
      return 'danger';
    case 'unchecked':
      return 'neutral';
  }
}

export function toVerdictValue(value: string): VerdictValue {
  return value === 'pending' ||
    value === 'verified' ||
    value === 'verified_with_warnings' ||
    value === 'unverified'
    ? value
    : 'unchecked';
}

export const CHECK_LABELS: Record<string, string> = {
  anchor_exists: 'Anchor exists on-chain',
  finality: 'Final (enough confirmations)',
  authorized_writer: 'Written by an authorized writer',
  device_and_type: 'Right device and record type',
  content_hash: 'Content hash matches',
  stored_payload: 'Stored record is byte-identical',
  record_commitment: 'Full private record unchanged',
  anchor_timeliness: 'Anchored on time',
};
