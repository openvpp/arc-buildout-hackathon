import { describe, expect, it } from 'vitest';

import {
  isProvenanceNotReadyError,
  ProvenanceNotReadyError,
} from '@/server/application/provenance/provenance-not-ready-error';

describe('ProvenanceNotReadyError', () => {
  it('is identified as retryable', () => {
    const error = new ProvenanceNotReadyError('awaiting nft');
    expect(error.retryable).toBe(true);
    expect(isProvenanceNotReadyError(error)).toBe(true);
    expect(isProvenanceNotReadyError(new Error('other'))).toBe(false);
  });
});
