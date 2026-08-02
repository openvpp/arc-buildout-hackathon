import { describe, expect, it } from 'vitest';

import {
  describeVerification,
  verificationLabel,
  verificationTone,
} from '@/features/verification';

describe('verification presentation helpers', () => {
  it('maps each status to a stable label', () => {
    expect(verificationLabel('not_started')).toBe('Not verified');
    expect(verificationLabel('verifying')).toBe('Verifying');
    expect(verificationLabel('verified')).toBe('Verified');
    expect(verificationLabel('failed')).toBe('Verification failed');
  });

  it('maps each status to a tone', () => {
    expect(verificationTone('verified')).toBe('success');
    expect(verificationTone('failed')).toBe('danger');
    expect(verificationTone('verifying')).toBe('info');
    expect(verificationTone('not_started')).toBe('neutral');
  });

  it('surfaces the failure reason in the description', () => {
    const description = describeVerification({
      status: 'failed',
      failedAt: '2026-01-01T00:00:00.000Z',
      reason: 'Content hash mismatch',
      anchorExists: true,
      contentHashMatches: false,
    });
    expect(description.tone).toBe('danger');
    expect(description.detail).toBe('Content hash mismatch');
  });

  it('describes the not-started and verifying states', () => {
    expect(describeVerification({ status: 'not_started' }).detail).toMatch(
      /has not run/,
    );
    expect(
      describeVerification({ status: 'verifying', startedAt: 't' }).detail,
    ).toMatch(/Checking/);
  });

  it('describes the verified state as independent evidence', () => {
    const description = describeVerification({
      status: 'verified',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      anchorExists: true,
      contentHashMatches: true,
    });
    expect(description.label).toBe('Verified');
    expect(description.detail).toMatch(/Arc/);
  });
});
