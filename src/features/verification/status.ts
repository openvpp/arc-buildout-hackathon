import { assertNever } from '@/lib/utils/assert-never';
import type { VerificationResult, VerificationStatus } from '@/types/domain';

/**
 * Presentation helpers for verification state. Verification is INDEPENDENT
 * evidence displayed to the user — never authorization to release telemetry.
 */

export type VerificationTone = 'neutral' | 'info' | 'success' | 'danger';

export type VerificationDescription = {
  readonly label: string;
  readonly tone: VerificationTone;
  readonly detail: string;
};

export function verificationLabel(status: VerificationStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not verified';
    case 'verifying':
      return 'Verifying';
    case 'verified':
      return 'Verified';
    case 'failed':
      return 'Verification failed';
    default:
      return assertNever(status);
  }
}

export function verificationTone(status: VerificationStatus): VerificationTone {
  switch (status) {
    case 'not_started':
      return 'neutral';
    case 'verifying':
      return 'info';
    case 'verified':
      return 'success';
    case 'failed':
      return 'danger';
    default:
      return assertNever(status);
  }
}

/** Derive a full, user-safe description from a verification result. */
export function describeVerification(
  result: VerificationResult,
): VerificationDescription {
  const base = {
    label: verificationLabel(result.status),
    tone: verificationTone(result.status),
  } as const;

  switch (result.status) {
    case 'not_started':
      return { ...base, detail: 'Independent verification has not run yet.' };
    case 'verifying':
      return { ...base, detail: 'Checking the Arc anchor and content hash.' };
    case 'verified':
      return {
        ...base,
        detail: 'Anchor exists on Arc testnet and the content hash matches.',
      };
    case 'failed':
      return { ...base, detail: result.reason };
    default:
      return assertNever(result);
  }
}
