/**
 * The verification vocabulary — verdicts, check ids and check statuses —
 * defined once. Types, Zod schemas, UI labels, the published spec and the
 * database CHECK constraints all derive from these lists, so adding a check
 * or verdict is one edit here (plus a migration for the CHECKs). Pure and
 * browser-safe.
 */

// Order matches the existing CHECK constraints' SQL (changing it would
// regenerate them).
export const VERDICTS = [
  'pending',
  'verified',
  'verified_with_warnings',
  'unverified',
] as const;
export type Verdict = (typeof VERDICTS)[number];

/** `device_events.verification_status`: a verdict, or not checked yet. */
export const VERIFICATION_STATUSES = ['unchecked', ...VERDICTS] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** In the order the checks run and are shown. */
export const CHECK_IDS = [
  'anchor_exists',
  'finality',
  'authorized_writer',
  'device_and_type',
  'content_hash',
  'stored_payload',
  'record_commitment',
  'anchor_timeliness',
] as const;
export type VerificationCheckId = (typeof CHECK_IDS)[number];

export const CHECK_STATUSES = [
  'pass',
  'fail',
  'warn',
  'pending',
  'skip',
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

export function isVerificationStatus(
  value: string,
): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

/** `'a', 'b'` — for building SQL CHECK constraints from these lists. */
export function sqlStringList(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ');
}
