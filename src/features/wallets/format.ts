/**
 * Wallet display helpers. Addresses are untrusted display strings in Phase 1 —
 * never used for signing or authorization.
 */

/**
 * Shorten an address for display: `0x1234…abcd`. Returns the input unchanged if
 * it is too short to shorten. Never assume an address is well-formed just
 * because it is a string.
 */
export function shortenAddress(address: string, visible = 4): string {
  if (address.length <= visible * 2 + 1) return address;
  return `${address.slice(0, visible + 2)}…${address.slice(-visible)}`;
}
