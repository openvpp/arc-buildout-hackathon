/**
 * Provisional BatchAnchor ABI for Arc testnet demos.
 *
 * Interface: single-hash commitment `anchorContentHash(bytes32)`.
 * Replace this artifact with the contract project's versioned ABI when available.
 * Do not treat this as production OpenVPP BatchAnchor.
 */
export const BATCH_ANCHOR_ABI = [
  {
    type: 'function',
    name: 'anchorContentHash',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'ContentHashAnchored',
    inputs: [
      { name: 'contentHash', type: 'bytes32', indexed: true },
      { name: 'submitter', type: 'address', indexed: true },
    ],
  },
] as const;

export const BATCH_ANCHOR_ABI_VERSION = 'provisional-anchorContentHash-v1';
