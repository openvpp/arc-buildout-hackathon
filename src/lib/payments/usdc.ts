/**
 * USDC amounts as exact integers of its smallest unit (6 decimals). Never
 * floats: a nanopayment of 0.001 USDC is 1000 atomic units. Pure and
 * browser-safe.
 */

export const USDC_DECIMALS = 6;
const SCALE = 10n ** BigInt(USDC_DECIMALS);
const DECIMAL = /^(\d+)(?:\.(\d{1,6}))?$/;

/** "0.001" → 1000n. Throws on anything that is not a plain decimal. */
export function parseUsdcToAtomic(decimal: string): bigint {
  const match = DECIMAL.exec(decimal.trim());
  if (match === null) {
    throw new Error(`Not a USDC amount with at most 6 decimals: ${decimal}`);
  }
  const whole = BigInt(match[1] ?? '0');
  const fraction = BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0'));
  return whole * SCALE + fraction;
}

/** 1000n → "0.001"; 1500000n → "1.5"; 0n → "0". */
export function formatUsdcAtomic(atomic: bigint | string): string {
  const value = typeof atomic === 'string' ? BigInt(atomic) : atomic;
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE)
    .toString()
    .padStart(USDC_DECIMALS, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction.length > 0 ? `.${fraction}` : ''}`;
}
