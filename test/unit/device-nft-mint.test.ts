import { encodeAbiParameters, encodeEventTopics, type Log } from 'viem';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import {
  createMockDeviceNftMinter,
  extractDeviceNftTokenIdFromLogs,
} from '@/server/infrastructure/blockchain/device-nft';
import { DEVICE_NFT_ABI } from '@/server/infrastructure/blockchain/device-nft-abi';

const WALLET = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

function deviceMintedLog(args: {
  tokenId: bigint;
  typeId: bigint;
  to: string;
}) {
  // All three DeviceMinted args are indexed, so they live in topics; data is empty.
  const topics = encodeEventTopics({
    abi: DEVICE_NFT_ABI,
    eventName: 'DeviceMinted',
    args: {
      tokenId: args.tokenId,
      typeId: args.typeId,
      to: args.to as `0x${string}`,
    },
  });
  // encodeEventTopics types topics loosely (nullable slots for absent indexed
  // args); every arg here is present, so narrow to the receipt-log shape.
  return { data: '0x', topics } as unknown as Pick<Log, 'data' | 'topics'>;
}

function transferSingleLog(args: { from: string; to: string; id: bigint }) {
  const topics = encodeEventTopics({
    abi: DEVICE_NFT_ABI,
    eventName: 'TransferSingle',
    args: {
      operator: WALLET as `0x${string}`,
      from: args.from as `0x${string}`,
      to: args.to as `0x${string}`,
    },
  });
  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [args.id, 1n],
  );
  return { data, topics } as unknown as Pick<Log, 'data' | 'topics'>;
}

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete (process.env as Record<string, string | undefined>)[key];
    return;
  }
  (process.env as Record<string, string | undefined>)[key] = value;
}

describe('extractDeviceNftTokenIdFromLogs', () => {
  it('returns the DeviceMinted token id when to/typeId match', () => {
    const logs = [deviceMintedLog({ tokenId: 7n, typeId: 1n, to: WALLET })];
    expect(
      extractDeviceNftTokenIdFromLogs(logs, { to: WALLET, typeId: 1n }),
    ).toBe('7');
  });

  it('rejects a DeviceMinted event for a different recipient', () => {
    const logs = [deviceMintedLog({ tokenId: 7n, typeId: 1n, to: OTHER })];
    expect(
      extractDeviceNftTokenIdFromLogs(logs, { to: WALLET, typeId: 1n }),
    ).toBeUndefined();
  });

  it('rejects a DeviceMinted event for a different typeId', () => {
    const logs = [deviceMintedLog({ tokenId: 7n, typeId: 9n, to: WALLET })];
    expect(
      extractDeviceNftTokenIdFromLogs(logs, { to: WALLET, typeId: 1n }),
    ).toBeUndefined();
  });

  it('falls back to a TransferSingle mint (from 0x0) to the recipient', () => {
    const logs = [transferSingleLog({ from: ZERO, to: WALLET, id: 42n })];
    expect(
      extractDeviceNftTokenIdFromLogs(logs, { to: WALLET, typeId: 1n }),
    ).toBe('42');
  });

  it('ignores a TransferSingle that is not a mint', () => {
    const logs = [transferSingleLog({ from: OTHER, to: WALLET, id: 42n })];
    expect(
      extractDeviceNftTokenIdFromLogs(logs, { to: WALLET, typeId: 1n }),
    ).toBeUndefined();
  });

  it('without expected args, trusts the first DeviceMinted (back-compat)', () => {
    const logs = [deviceMintedLog({ tokenId: 5n, typeId: 3n, to: OTHER })];
    expect(extractDeviceNftTokenIdFromLogs(logs)).toBe('5');
  });
});

describe('mock DeviceNFT minter', () => {
  const previous = process.env.ALLOW_MOCK_ADAPTERS;

  beforeEach(() => {
    resetServerEnvCache();
    setEnv('APP_ENV', 'test');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
  });

  afterEach(() => {
    setEnv('ALLOW_MOCK_ADAPTERS', previous);
    resetServerEnvCache();
  });

  it('invokes onBroadcast with the tx hash and reconcile returns null', async () => {
    const minter = createMockDeviceNftMinter();
    let broadcast: string | null = null;
    const result = await minter.mintDevice({
      to: WALLET,
      typeId: 1n,
      deviceURI: 'data:application/json;base64,e30=',
      onBroadcast: (hash) => {
        broadcast = hash;
      },
    });
    expect(result.tokenId).toMatch(/^\d+$/);
    expect(result.transactionHash).toBe(broadcast);
    expect(
      await minter.reconcileMint({
        transactionHash: result.transactionHash,
        to: WALLET,
        typeId: 1n,
      }),
    ).toBeNull();
  });
});
