import { describe, expect, it } from 'vitest';

import { shortenAddress } from '@/features/wallets';

describe('shortenAddress', () => {
  it('shortens a long address with an ellipsis', () => {
    const shortened = shortenAddress('0x1234567890abcdef1234567890abcdef');
    expect(shortened).toContain('…');
    expect(shortened.startsWith('0x1234')).toBe(true);
    expect(shortened.endsWith('cdef')).toBe(true);
  });

  it('returns short inputs unchanged', () => {
    expect(shortenAddress('0x12')).toBe('0x12');
  });
});
