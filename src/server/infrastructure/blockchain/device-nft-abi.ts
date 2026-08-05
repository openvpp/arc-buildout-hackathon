/**
 * Provisional DeviceNFT ABI for Arc testnet EV registry mint.
 * Arc DeviceNFT is ERC-1155-style: mint emits TransferSingle + DeviceMinted
 * (not ERC-721 Transfer).
 */
export const DEVICE_NFT_ABI = [
  {
    type: 'function',
    name: 'mintDevice',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'typeId', type: 'uint256' },
      { name: 'deviceURI', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'DeviceMinted',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'typeId', type: 'uint256', indexed: true },
      { name: 'to', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'TransferSingle',
    inputs: [
      { name: 'operator', type: 'address', indexed: true },
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'id', type: 'uint256', indexed: false },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;
