/**
 * Provisional DeviceNFT ABI for Arc testnet EV registry mint + device events.
 * Arc DeviceNFT is ERC-1155-style: mint emits TransferSingle + DeviceMinted
 * (not ERC-721 Transfer). Provenance commits use `recordDeviceEvent`.
 */

/** DeviceEvent.eventType for telemetry content-hash commitments. */
export const DEVICE_EVENT_TYPE_TELEMETRY_HASH = 1;

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
    name: 'DeviceMinted',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'typeId', type: 'uint256', indexed: true },
      { name: 'to', type: 'address', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'DeviceEvent',
    inputs: [
      { name: 'tokenId', type: 'uint256', indexed: true },
      { name: 'eventType', type: 'uint8', indexed: true },
      { name: 'data', type: 'bytes', indexed: false },
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
