import { describe, expect, it } from 'vitest';

import {
  arcNetworkDisplayName,
  arcNetworkLabel,
  defaultArcExplorerApiUrl,
  defaultArcExplorerUrl,
  defaultArcRpcUrl,
} from '@/config/arc-network';
import {
  assertArcNetworkConfig,
  assertTrustedWritersConfig,
} from '@/server/config/env';

describe('arc network naming', () => {
  it('names mainnet and testnet from the chain id', () => {
    expect(arcNetworkLabel('5042')).toBe('arc-mainnet-5042');
    expect(arcNetworkLabel('5042002')).toBe('arc-testnet-5042002');
    expect(arcNetworkLabel('77')).toBe('arc-chain-77');
    expect(arcNetworkDisplayName('5042')).toBe('Arc mainnet');
    expect(arcNetworkDisplayName('5042002')).toBe('Arc testnet');
  });

  it("falls back to Arc's public RPC per network, never across networks", () => {
    expect(defaultArcRpcUrl('5042002')).toBe('https://rpc.testnet.arc.io');
    expect(defaultArcRpcUrl('5042')).toBe('https://rpc.mainnet.arc.io');
    expect(defaultArcRpcUrl('77')).toBeNull();
  });

  it('defaults the explorer to the matching network', () => {
    expect(defaultArcExplorerUrl('5042')).toBe('https://explorer.arc.io');
    expect(defaultArcExplorerUrl('5042002')).toBe(
      'https://explorer.testnet.arc.io',
    );
    expect(defaultArcExplorerApiUrl('77')).toBeNull();
  });
});

describe('assertArcNetworkConfig', () => {
  const mainnet = {
    ARC_CHAIN_ID: '5042',
    ARC_RPC_URL: 'https://rpc.example',
    USE_ARC_NETWORK: true,
    CIRCLE_WALLET_BLOCKCHAIN: 'ARC',
  };

  it('accepts a consistent mainnet config', () => {
    expect(() => assertArcNetworkConfig(mainnet, '5042')).not.toThrow();
    expect(() => assertArcNetworkConfig(mainnet, undefined)).not.toThrow();
  });

  it('rejects a public chain id that differs from the server one', () => {
    expect(() => assertArcNetworkConfig(mainnet, '5042002')).toThrow(
      /NEXT_PUBLIC_ARC_CHAIN_ID/,
    );
  });

  it('requires ARC_RPC_URL on mainnet and unknown chains, not on testnet', () => {
    expect(() =>
      assertArcNetworkConfig({ ...mainnet, ARC_RPC_URL: undefined }, '5042'),
    ).toThrow(/required on Arc mainnet/);
    expect(() =>
      assertArcNetworkConfig(
        { ...mainnet, ARC_RPC_URL: undefined, USE_ARC_NETWORK: false },
        '5042',
      ),
    ).not.toThrow();
    expect(() =>
      assertArcNetworkConfig(
        { ...mainnet, ARC_CHAIN_ID: '77', ARC_RPC_URL: undefined },
        undefined,
      ),
    ).toThrow(/ARC_RPC_URL is required/);
    expect(() =>
      assertArcNetworkConfig(
        {
          ...mainnet,
          ARC_CHAIN_ID: '5042002',
          ARC_RPC_URL: undefined,
          CIRCLE_WALLET_BLOCKCHAIN: 'ARC-TESTNET',
        },
        '5042002',
      ),
    ).not.toThrow();
  });

  it('rejects a testnet Circle wallet chain on mainnet', () => {
    expect(() =>
      assertArcNetworkConfig(
        { ...mainnet, CIRCLE_WALLET_BLOCKCHAIN: 'ARC-TESTNET' },
        '5042',
      ),
    ).toThrow(/CIRCLE_WALLET_BLOCKCHAIN/);
  });
});

describe('assertTrustedWritersConfig', () => {
  const base = {
    ARC_TRUSTED_WRITER_ADDRESSES: '',
    APP_ENV: 'development' as const,
    USE_ARC_NETWORK: true,
  };

  it('accepts any letter case and rejects malformed entries', () => {
    expect(() =>
      assertTrustedWritersConfig({
        ...base,
        ARC_TRUSTED_WRITER_ADDRESSES:
          '0x0E12C056A563C7EBC652E288E09C9BE524044CEA, 0x0e12c056a563c7ebc652e288e09c9be524044cea',
      }),
    ).not.toThrow();
    expect(() =>
      assertTrustedWritersConfig({
        ...base,
        ARC_TRUSTED_WRITER_ADDRESSES: '0x0e12c056a563c7eb,0xabc',
      }),
    ).toThrow(/2 invalid address/);
  });

  it('requires an explicit list on staging and production', () => {
    expect(() => assertTrustedWritersConfig(base)).not.toThrow();
    expect(() =>
      assertTrustedWritersConfig({ ...base, APP_ENV: 'production' }),
    ).toThrow(/must list the writer/);
    expect(() =>
      assertTrustedWritersConfig({
        ...base,
        APP_ENV: 'staging',
        ARC_TRUSTED_WRITER_ADDRESSES:
          '0x0e12c056a563c7ebc652e288e09c9be524044cea',
      }),
    ).not.toThrow();
  });
});
