/**
 * DeviceNFT ABI for the Arc EV registry. ERC-1155-style: mint emits
 * TransferSingle + DeviceMinted (not ERC-721 Transfer). `recordDeviceEvent`
 * (requires UPDATER_ROLE) appends to a token's on-chain time series and
 * emits DeviceEvent — its signature includes the block `timestamp`, verified
 * against the deployed contract's logs.
 */
export const DEVICE_NFT_ABI = [
  {
    type: 'function',
    name: 'recordDeviceEvent',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'eventType', type: 'uint8' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'DeviceEvent',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'eventType', type: 'uint8', indexed: true },
      { name: 'data', type: 'bytes', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
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
