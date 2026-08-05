import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from 'viem';
import { afterEach, describe, expect, it } from 'vitest';

import {
  parseServerEnv,
  resetServerEnvCache,
  type RawServerEnv,
} from '@/server/config/env';
import {
  buildSimpleDeviceMetadataUri,
  extractDeviceNftTokenIdFromLogs,
} from '@/server/infrastructure/blockchain/device-nft';
import {
  isDeviceNftMintConfigured,
  resolveDeviceNftNetwork,
} from '@/server/infrastructure/blockchain/network-provider';

const baseEnv: RawServerEnv = {
  NODE_ENV: 'test',
  APP_ENV: 'demo',
  DATABASE_URL:
    'postgresql://postgres:postgres@localhost:5433/ev_telemetry_test',
  API_KEY_HASH_SECRET: 'test-api-key-hash-secret-32chars!!',
  ALLOW_MOCK_ADAPTERS: 'false',
  SELLER_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
};

describe('resolveDeviceNftNetwork', () => {
  afterEach(() => {
    resetServerEnvCache();
  });

  it('selects arc when USE_ARC_NETWORK + RPC + AUTH_TOKEN are set', () => {
    const env = parseServerEnv({
      ...baseEnv,
      USE_ARC_NETWORK: 'true',
      ARC_RPC_URL: 'https://rpc.testnet.arc.network/token',
      ARC_AUTH_TOKEN: 'token',
    });
    expect(resolveDeviceNftNetwork(env)).toBe('arc');
  });

  it('is unavailable when Arc flags are incomplete', () => {
    const env = parseServerEnv({
      ...baseEnv,
      USE_ARC_NETWORK: 'true',
      ARC_RPC_URL: 'https://rpc.testnet.arc.network/token',
    });
    expect(resolveDeviceNftNetwork(env)).toBe('unavailable');
  });

  it('accepts ovpp-style PRIVATE_KEY as minter', () => {
    const env = parseServerEnv({
      ...baseEnv,
      USE_ARC_NETWORK: 'true',
      ARC_RPC_URL: 'https://rpc.testnet.arc.network/token',
      ARC_AUTH_TOKEN: 'token',
      DEVICE_NFT_CONTRACT_ADDRESS: '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908',
      PRIVATE_KEY:
        '57ef5c9d241ef31921e2f885674703e09565927783ffe37c1954b6409f307a3e',
    });
    expect(isDeviceNftMintConfigured(env)).toBe(true);
  });
});

describe('buildSimpleDeviceMetadataUri', () => {
  it('encodes a data URI with vehicleId', () => {
    const uri = buildSimpleDeviceMetadataUri({
      vehicleId: 'enode-vehicle-1',
      displayName: 'Tesla',
      make: 'Tesla',
      model: 'Model 3',
      year: 2024,
      walletAddress: '0x92953cd96b6cee71c885602cfbee06194189cb2f',
    });
    expect(uri.startsWith('data:application/json;base64,')).toBe(true);
    const json = Buffer.from(uri.split(',')[1] ?? '', 'base64').toString(
      'utf8',
    );
    expect(json).toContain('enode-vehicle-1');
    expect(json).toContain('Tesla');
  });
});

describe('extractDeviceNftTokenIdFromLogs', () => {
  it('prefers DeviceMinted tokenId over TransferSingle', () => {
    const deviceMintedTopics = encodeEventTopics({
      abi: [
        parseAbiItem(
          'event DeviceMinted(uint256 indexed tokenId, uint256 indexed typeId, address indexed to)',
        ),
      ],
      args: {
        tokenId: 60n,
        typeId: 1n,
        to: '0xeF1F84dAc46dDa9329E5EE7dE6E196a2B42b5604',
      },
    });
    const transferSingleTopics = encodeEventTopics({
      abi: [
        parseAbiItem(
          'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
        ),
      ],
      args: {
        operator: '0x0e12C056a563c7Ebc652E288e09C9Be524044CeA',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xeF1F84dAc46dDa9329E5EE7dE6E196a2B42b5604',
      },
    });
    const transferSingleData = encodeAbiParameters(
      [
        { name: 'id', type: 'uint256' },
        { name: 'value', type: 'uint256' },
      ],
      [99n, 1n],
    );

    const tokenId = extractDeviceNftTokenIdFromLogs([
      {
        topics: transferSingleTopics as [`0x${string}`, ...`0x${string}`[]],
        data: transferSingleData,
      },
      {
        topics: deviceMintedTopics as [`0x${string}`, ...`0x${string}`[]],
        data: '0x',
      },
    ]);

    expect(tokenId).toBe('60');
  });

  it('falls back to ERC-1155 TransferSingle id', () => {
    const transferSingleTopics = encodeEventTopics({
      abi: [
        parseAbiItem(
          'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
        ),
      ],
      args: {
        operator: '0x0e12C056a563c7Ebc652E288e09C9Be524044CeA',
        from: '0x0000000000000000000000000000000000000000',
        to: '0xeF1F84dAc46dDa9329E5EE7dE6E196a2B42b5604',
      },
    });
    const transferSingleData = encodeAbiParameters(
      [
        { name: 'id', type: 'uint256' },
        { name: 'value', type: 'uint256' },
      ],
      [60n, 1n],
    );

    expect(
      extractDeviceNftTokenIdFromLogs([
        {
          topics: transferSingleTopics as [`0x${string}`, ...`0x${string}`[]],
          data: transferSingleData,
        },
      ]),
    ).toBe('60');
  });

  it('returns undefined when no mint events are present', () => {
    expect(
      extractDeviceNftTokenIdFromLogs([
        {
          topics: [
            '0x48ba5d0cb196bcbec6fd9280d7bd5c48286930c49df4a12a8707bf3f5999d4c1',
          ],
          data: '0x',
        },
      ]),
    ).toBeUndefined();
  });
});

describe('parseServerEnv DeviceNFT guards', () => {
  it('rejects production with DeviceNFT minter private key', () => {
    expect(() =>
      parseServerEnv({
        ...baseEnv,
        APP_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/ev_telemetry',
        API_KEY_HASH_SECRET: 'prod-api-key-hash-secret-32chars!!',
        DEVICE_NFT_MINTER_PRIVATE_KEY:
          '0x1111111111111111111111111111111111111111111111111111111111111111',
      }),
    ).toThrow(/DeviceNFT minter private keys are forbidden/);
  });
});
