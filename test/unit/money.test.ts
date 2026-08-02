import { describe, expect, it } from 'vitest';

import {
  formatAtomicAmount,
  isValidEvmAddress,
  normalizeTransactionHash,
} from '@/server/domain/shared/money';

describe('formatAtomicAmount', () => {
  it('formats the default telemetry price without floating point', () => {
    expect(formatAtomicAmount('400', 6)).toBe('0.0004');
  });

  it('formats whole units', () => {
    expect(formatAtomicAmount('1000000', 6)).toBe('1.0');
  });

  it('rejects invalid atomic strings', () => {
    expect(() => formatAtomicAmount('1.5', 6)).toThrow(/integer string/);
  });
});

describe('normalizeTransactionHash', () => {
  it('normalizes a valid hash', () => {
    const hash =
      '0xABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789';
    expect(normalizeTransactionHash(hash)).toBe(hash.toLowerCase());
  });

  it('rejects malformed hashes', () => {
    expect(() => normalizeTransactionHash('0x1234')).toThrow(/Invalid/);
  });
});

describe('isValidEvmAddress', () => {
  it('accepts a checksummable hex address', () => {
    expect(
      isValidEvmAddress('0x1111111111111111111111111111111111111111'),
    ).toBe(true);
  });

  it('rejects short addresses', () => {
    expect(isValidEvmAddress('0x1234')).toBe(false);
  });
});
