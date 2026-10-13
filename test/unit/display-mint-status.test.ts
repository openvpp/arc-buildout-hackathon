import { describe, expect, it } from 'vitest';

import { displayMintStatus } from '@/server/application/dashboard/display-mint-status';

describe('displayMintStatus', () => {
  it('shows a legacy Arc mint while the local mint column stays unminted', () => {
    expect(
      displayMintStatus('unminted', { legacyArcMintStatus: 'minted' }),
    ).toBe('minted');
  });

  it('keeps this app mint column when it has moved past unminted', () => {
    expect(
      displayMintStatus('pending', { legacyArcMintStatus: 'minted' }),
    ).toBe('pending');
  });

  it('stays unminted without a legacy mint', () => {
    expect(
      displayMintStatus('unminted', { legacySource: 'ovpp-vehicles' }),
    ).toBe('unminted');
    expect(displayMintStatus('unminted', null)).toBe('unminted');
  });
});
