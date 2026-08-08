import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  ownedEvmAddressesFromIdToken,
  resolveWalletAddressForOnboarding,
} from '@/lib/auth/web3auth-wallet-claims';

function encodeJwtPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64url');
  return `hdr.${b64}.sig`;
}

describe('web3auth wallet claims', () => {
  it('prefers session address when it is bound in the token', () => {
    const session = '0x84f688dc18c38690464dd42520a6cca29fdf09d5';
    const token = encodeJwtPayload({
      wallets: [{ type: 'ethereum', address: session }],
    });
    expect(
      resolveWalletAddressForOnboarding({
        idToken: token,
        sessionAddress: session,
      }),
    ).toBe(session);
  });

  it('uses id-token address when a different session address is hinted', () => {
    const session = '0x84f688dc18c38690464dd42520a6cca29fdf09d5';
    const bound = '0x838ece260fd5ff3b48a05b2d3e0053fa469ddef5';
    const token = encodeJwtPayload({
      wallets: [{ type: 'ethereum', address: bound }],
    });
    expect(
      resolveWalletAddressForOnboarding({
        idToken: token,
        sessionAddress: session,
      }),
    ).toBe(bound);
  });

  it('resolves from token alone without session address', () => {
    const bound = '0x838ece260fd5ff3b48a05b2d3e0053fa469ddef5';
    const token = encodeJwtPayload({
      wallets: [{ type: 'ethereum', address: bound }],
    });
    expect(resolveWalletAddressForOnboarding({ idToken: token })).toBe(bound);
  });

  it('derives app-key addresses from secp256k1 public keys', () => {
    const account = privateKeyToAccount(
      '0x1111111111111111111111111111111111111111111111111111111111111111',
    );
    const uncompressed = account.publicKey;
    const token = encodeJwtPayload({
      wallets: [
        {
          type: 'web3auth_app_key',
          curve: 'secp256k1',
          public_key: uncompressed.slice(2),
        },
      ],
    });
    expect(ownedEvmAddressesFromIdToken(token)).toContain(
      account.address.toLowerCase(),
    );
  });
});
