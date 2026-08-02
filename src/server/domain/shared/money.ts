/**
 * Convert atomic token amounts (integer string) to a decimal display string
 * without floating-point arithmetic.
 */
export function formatAtomicAmount(
  amountAtomic: string,
  decimals: number,
): string {
  if (!/^\d+$/.test(amountAtomic)) {
    throw new Error('amountAtomic must be a non-negative integer string');
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('decimals must be a non-negative integer');
  }

  const padded = amountAtomic.padStart(decimals + 1, '0');
  if (decimals === 0) {
    return padded;
  }

  const whole = padded.slice(0, -decimals) || '0';
  const fraction = padded.slice(-decimals);
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction.length > 0
    ? `${whole}.${trimmedFraction}`
    : `${whole}.0`;
}

export function normalizeTransactionHash(hash: string): string {
  const trimmed = hash.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(trimmed)) {
    throw new Error('Invalid transaction hash');
  }
  return trimmed;
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}
