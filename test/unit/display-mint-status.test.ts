import { describe, expect, it } from 'vitest';

import {
  displayMintStatus,
  displayNftTokenId,
} from '@/server/application/dashboard/display-mint-status';

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

describe('displayNftTokenId', () => {
  it('shows the imported Arc token when the mint column is empty', () => {
    expect(displayNftTokenId(null, { legacyArcNftTokenId: '19' })).toBe('19');
  });

  it('keeps a token this app minted', () => {
    expect(displayNftTokenId('7', { legacyArcNftTokenId: '19' })).toBe('7');
  });

  it('ignores a missing or non-numeric legacy token', () => {
    expect(displayNftTokenId(null, { legacySource: 'ovpp-vehicles' })).toBe(
      null,
    );
    expect(displayNftTokenId('', { legacyArcNftTokenId: 'base-667' })).toBe(
      null,
    );
    expect(displayNftTokenId(null, null)).toBe(null);
  });
});
