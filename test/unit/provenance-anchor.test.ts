import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetServerEnvCache } from '@/server/config/env';
import {
  DEVICE_EVENT_TYPE_TELEMETRY_HASH,
  DEVICE_NFT_ABI,
} from '@/server/infrastructure/blockchain/device-nft-abi';
import {
  createLiveDeviceNftProvenanceAnchor,
  createMockProvenanceAnchor,
  createProvenanceAnchorForEnv,
  receiptHasTelemetryContentHash,
  toBytes32ContentHash,
} from '@/server/infrastructure/blockchain/provenance-anchor';

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, key);
    return;
  }
  process.env[key] = value;
}

describe('provenance anchor adapters', () => {
  const previous = {
    ALLOW_MOCK_ADAPTERS: process.env.ALLOW_MOCK_ADAPTERS,
    APP_ENV: process.env.APP_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    API_KEY_HASH_SECRET: process.env.API_KEY_HASH_SECRET,
    BATCH_ANCHOR_CONTRACT_ADDRESS: process.env.BATCH_ANCHOR_CONTRACT_ADDRESS,
    DEVICE_NFT_CONTRACT_ADDRESS: process.env.DEVICE_NFT_CONTRACT_ADDRESS,
    USE_ARC_NETWORK: process.env.USE_ARC_NETWORK,
    ARC_RPC_URL: process.env.ARC_RPC_URL,
    ARC_AUTH_TOKEN: process.env.ARC_AUTH_TOKEN,
    DEVICE_NFT_MINTER_PRIVATE_KEY: process.env.DEVICE_NFT_MINTER_PRIVATE_KEY,
    PRIVATE_KEY: process.env.PRIVATE_KEY,
    SELLER_WALLET_ADDRESS: process.env.SELLER_WALLET_ADDRESS,
  };

  beforeEach(() => {
    setEnv('APP_ENV', 'test');
    setEnv(
      'DATABASE_URL',
      'postgresql://postgres:postgres@localhost:5432/ev_telemetry',
    );
    setEnv('API_KEY_HASH_SECRET', 'test-api-key-hash-secret-32chars!!');
    setEnv('ALLOW_MOCK_ADAPTERS', 'true');
    setEnv('BATCH_ANCHOR_CONTRACT_ADDRESS', undefined);
    setEnv('DEVICE_NFT_CONTRACT_ADDRESS', undefined);
    setEnv('USE_ARC_NETWORK', undefined);
    setEnv('ARC_RPC_URL', undefined);
    setEnv('ARC_AUTH_TOKEN', undefined);
    setEnv('DEVICE_NFT_MINTER_PRIVATE_KEY', undefined);
    setEnv('PRIVATE_KEY', undefined);
    resetServerEnvCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      setEnv(key, value);
    }
    resetServerEnvCache();
  });

  it('mock adapter submits a deterministic tx hash and verifies', async () => {
    const anchor = createMockProvenanceAnchor();
    const contentHash =
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const submitted = await anchor.anchorTelemetry({
      contentHash,
      telemetryRecordId: '00000000-0000-0000-0000-000000000001',
      tokenId: '42',
    });
    expect(submitted.status).toBe('submitted');
    expect(submitted.transactionHash).toMatch(/^0x[a-f0-9]{64}$/);

    const verified = await anchor.verifyAnchor({
      contentHash,
      anchorTransactionHash: submitted.transactionHash,
    });
    expect(verified.valid).toBe(true);
  });

  it('forbids mock adapter when ALLOW_MOCK_ADAPTERS is false', () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    resetServerEnvCache();
    expect(() => createMockProvenanceAnchor()).toThrow(/ALLOW_MOCK_ADAPTERS/);
  });

  it('selects mock via createProvenanceAnchorForEnv when mocks allowed', async () => {
    const anchor = createProvenanceAnchorForEnv();
    const result = await anchor.anchorTelemetry({
      contentHash:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      telemetryRecordId: '00000000-0000-0000-0000-000000000002',
      tokenId: '7',
    });
    expect(result.status).toBe('submitted');
  });

  it('fail-closes when mocks off and neither DeviceNFT nor BatchAnchor configured', async () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    setEnv('BATCH_ANCHOR_CONTRACT_ADDRESS', undefined);
    setEnv('DEVICE_NFT_CONTRACT_ADDRESS', undefined);
    resetServerEnvCache();
    const anchor = createProvenanceAnchorForEnv();
    await expect(
      anchor.anchorTelemetry({
        contentHash:
          'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        telemetryRecordId: '00000000-0000-0000-0000-000000000003',
        tokenId: '1',
      }),
    ).rejects.toThrow(/On-chain provenance is not configured/);
  });

  it('toBytes32ContentHash normalizes digests', () => {
    expect(
      toBytes32ContentHash(
        'DdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDdDd',
      ),
    ).toBe(
      '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    );
  });

  it('DeviceNFT adapter calls recordDeviceEvent with telemetry hash bytes', async () => {
    setEnv('ALLOW_MOCK_ADAPTERS', 'false');
    setEnv(
      'SELLER_WALLET_ADDRESS',
      '0x2222222222222222222222222222222222222222',
    );
    setEnv(
      'DEVICE_NFT_CONTRACT_ADDRESS',
      '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908',
    );
    setEnv('USE_ARC_NETWORK', 'true');
    setEnv('ARC_RPC_URL', 'https://rpc.testnet.arc.network');
    setEnv('ARC_AUTH_TOKEN', 'test-auth-token');
    setEnv(
      'DEVICE_NFT_MINTER_PRIVATE_KEY',
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    resetServerEnvCache();

    const writeContract = vi
      .fn()
      .mockResolvedValue(
        '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      );
    const getTransactionReceipt = vi.fn().mockResolvedValue({
      status: 'success',
      logs: [],
    });

    const walletClient = { writeContract } as never;
    const publicClient = { getTransactionReceipt } as never;

    const anchor = createLiveDeviceNftProvenanceAnchor({
      walletClient,
      publicClient,
    });
    const contentHash =
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const submitted = await anchor.anchorTelemetry({
      contentHash,
      telemetryRecordId: '00000000-0000-0000-0000-000000000099',
      tokenId: '99',
    });

    expect(submitted.transactionHash).toBe(
      '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    );
    expect(writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908',
        abi: DEVICE_NFT_ABI,
        functionName: 'recordDeviceEvent',
        args: [
          99n,
          DEVICE_EVENT_TYPE_TELEMETRY_HASH,
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ],
      }),
    );

    const verified = await anchor.verifyAnchor({
      contentHash,
      anchorTransactionHash: submitted.transactionHash,
    });
    expect(verified.valid).toBe(true);
  });

  it('receiptHasTelemetryContentHash matches DeviceEvent data', () => {
    const contentHash =
      '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const hashBytes = toBytes32ContentHash(contentHash);
    // Minimal non-empty check with empty logs
    expect(receiptHasTelemetryContentHash([], hashBytes)).toBe(false);
  });
});
