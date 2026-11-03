// @vitest-environment node
// viem signing needs Node's crypto and Uint8Array (jsdom's is cross-realm).
import { CHAIN_CONFIGS } from '@circle-fin/x402-batching/client';
import { generatePrivateKey } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { formatUsdcAtomic, parseUsdcToAtomic } from '@/lib/payments/usdc';
import { assertStaticPayerAllowed } from '@/server/config/env';
import { resolveArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';
import { createGatewayBuyer } from '@/server/infrastructure/payments/gateway-buyer';
import {
  createGatewayTransferLookup,
  settlementOutcome,
} from '@/server/infrastructure/payments/gateway-transfers';
import {
  createGatewaySeller,
  type FacilitatorPort,
} from '@/server/infrastructure/payments/gateway-seller';
import {
  createMockGatewayBuyer,
  createMockGatewaySeller,
} from '@/server/infrastructure/payments/mock-gateway';
import {
  buildPaymentRequired,
  decodePaymentRequiredHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  findGatewayRequirements,
} from '@/server/infrastructure/payments/x402';

const testnet = resolveArcPaymentNetwork({
  ARC_CHAIN_ID: '5042002',
  CIRCLE_GATEWAY_FACILITATOR_URL: undefined,
});
if (testnet === null) throw new Error('Arc testnet must resolve');

const SELLER = '0x1111111111111111111111111111111111111111';

function paymentRequired(amountAtomic = 1000n) {
  return buildPaymentRequired({
    network: testnet!,
    payTo: SELLER,
    amountAtomic,
    resourceUrl: 'https://app.example/api/v1/events/e1/unlock',
    description: 'Unlock one device event',
  });
}

describe('USDC amounts', () => {
  it('converts exact decimals to atomic units and back, never via floats', () => {
    expect(parseUsdcToAtomic('0.001')).toBe(1000n);
    expect(parseUsdcToAtomic('1')).toBe(1_000_000n);
    expect(parseUsdcToAtomic('12.345678')).toBe(12_345_678n);
    expect(formatUsdcAtomic(1000n)).toBe('0.001');
    expect(formatUsdcAtomic('1500000')).toBe('1.5');
    expect(formatUsdcAtomic(0n)).toBe('0');
    // 0.1 + 0.2 style float drift cannot happen.
    expect(parseUsdcToAtomic('0.1') + parseUsdcToAtomic('0.2')).toBe(
      parseUsdcToAtomic('0.3'),
    );
  });

  it('rejects anything but a plain amount with at most 6 decimals', () => {
    for (const bad of ['', '-1', '1e3', '0.0000001', 'abc', '1.2.3']) {
      expect(() => parseUsdcToAtomic(bad)).toThrow();
    }
  });
});

describe('Arc payment network', () => {
  it('derives testnet and mainnet values from the Circle SDK by chain id', () => {
    expect(testnet).toMatchObject({
      gatewayChain: 'arcTestnet',
      caip2: 'eip155:5042002',
      usdcAddress: CHAIN_CONFIGS.arcTestnet.usdc,
      gatewayWalletAddress: CHAIN_CONFIGS.arcTestnet.gatewayWallet,
      facilitatorUrl: 'https://gateway-api-testnet.circle.com',
      isTestnet: true,
    });
    expect(
      resolveArcPaymentNetwork({
        ARC_CHAIN_ID: '5042',
        CIRCLE_GATEWAY_FACILITATOR_URL: undefined,
      }),
    ).toMatchObject({
      gatewayChain: 'arc',
      caip2: 'eip155:5042',
      gatewayWalletAddress: CHAIN_CONFIGS.arc.gatewayWallet,
      facilitatorUrl: 'https://gateway-api.circle.com',
    });
    expect(
      resolveArcPaymentNetwork({
        ARC_CHAIN_ID: '77',
        CIRCLE_GATEWAY_FACILITATOR_URL: undefined,
      }),
    ).toBeNull();
  });
});

describe('x402 headers', () => {
  it('round-trips a Gateway payment requirement', () => {
    const body = paymentRequired();
    const decoded = decodePaymentRequiredHeader(
      encodePaymentRequiredHeader(body),
    );
    expect(decoded).toEqual(body);
    const option = decoded === null ? null : findGatewayRequirements(decoded);
    expect(option).toMatchObject({
      scheme: 'exact',
      network: 'eip155:5042002',
      amount: '1000',
      payTo: SELLER,
      extra: { name: 'GatewayWalletBatched' },
    });
    // Gateway rejects authorizations valid for less than ~7 days.
    expect(option?.maxTimeoutSeconds).toBeGreaterThanOrEqual(7 * 86_400);
  });

  it('treats malformed headers as no payment', () => {
    expect(decodePaymentRequiredHeader('not base64 json')).toBeNull();
    expect(decodePaymentSignatureHeader('')).toBeNull();
    expect(
      decodePaymentSignatureHeader(
        Buffer.from('{"x402Version":2}').toString('base64'),
      ),
    ).toBeNull();
  });
});

describe('Gateway buyer (offline signing)', () => {
  it('signs a Gateway authorization for exactly the quoted payment', async () => {
    const buyer = createGatewayBuyer({
      network: testnet,
      privateKey: generatePrivateKey(),
      rpcUrl: 'https://rpc.testnet.arc.io',
    });
    const header = await buyer.createPaymentSignatureHeader(paymentRequired());
    const signature = decodePaymentSignatureHeader(header);
    expect(signature?.x402Version).toBe(2);
    expect(signature?.accepted).toMatchObject({
      amount: '1000',
      payTo: SELLER,
    });
    const authorization = (
      signature?.payload as {
        authorization?: Record<string, unknown>;
      }
    ).authorization;
    expect(authorization).toMatchObject({ to: SELLER, value: '1000' });
    expect(String(authorization?.['from']).toLowerCase()).toBe(buyer.address);
    expect(typeof signature?.payload['signature']).toBe('string');
  });
});

describe('Gateway seller', () => {
  const header = Buffer.from(
    JSON.stringify({ x402Version: 2, payload: { signature: '0x01' } }),
  ).toString('base64');
  const requirements = findGatewayRequirements(paymentRequired());
  if (requirements === null) throw new Error('expected requirements');

  function sellerWith(settle: FacilitatorPort['settle']) {
    return createGatewaySeller({ network: testnet!, facilitator: { settle } });
  }

  it("returns Gateway's transfer id and the payer when it accepts", async () => {
    const result = await sellerWith(async () => ({
      success: true,
      transaction: '5a1b-transfer-id',
      payer: '0xABCDEF0000000000000000000000000000000001',
      network: 'eip155:5042002',
    })).settle({ paymentSignatureHeader: header, requirements });
    expect(result).toEqual({
      success: true,
      reference: '5a1b-transfer-id',
      payer: '0xabcdef0000000000000000000000000000000001',
      network: 'eip155:5042002',
    });
  });

  it('separates a refused payment from an unreachable Gateway', async () => {
    const refused = await sellerWith(async () => ({
      success: false,
      errorReason: 'insufficient_balance',
      transaction: '',
      network: 'eip155:5042002',
    })).settle({ paymentSignatureHeader: header, requirements });
    expect(refused).toMatchObject({ success: false, code: 'invalid' });

    const down = await sellerWith(async () => {
      throw new Error('ECONNRESET');
    }).settle({ paymentSignatureHeader: header, requirements });
    expect(down).toMatchObject({ success: false, code: 'unavailable' });

    // Accepted without a payer field: the payment is not lost; the payer is
    // the signer of the authorization.
    const signedHeader = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        payload: {
          authorization: { from: '0xAbC0000000000000000000000000000000000002' },
        },
      }),
    ).toString('base64');
    const noPayer = await sellerWith(async () => ({
      success: true,
      transaction: 'transfer-2',
      network: 'eip155:5042002',
    })).settle({ paymentSignatureHeader: signedHeader, requirements });
    expect(noPayer).toMatchObject({
      success: true,
      payer: '0xabc0000000000000000000000000000000000002',
    });

    const garbage = await sellerWith(async () => {
      throw new Error('must not be called');
    }).settle({ paymentSignatureHeader: 'garbage', requirements });
    expect(garbage).toMatchObject({ success: false, code: 'invalid' });
  });
});

describe('mock adapters', () => {
  it('pay and settle end to end without Circle', async () => {
    const buyer = createMockGatewayBuyer();
    const header = await buyer.createPaymentSignatureHeader(paymentRequired());
    const requirements = findGatewayRequirements(paymentRequired());
    if (requirements === null) throw new Error('expected requirements');
    const result = await createMockGatewaySeller().settle({
      paymentSignatureHeader: header,
      requirements,
    });
    expect(result).toMatchObject({ success: true, payer: buyer.address });
  });
});

describe('static payer guard', () => {
  it('refuses the static payer key in production only', () => {
    const key = `0x${'1'.repeat(64)}`;
    expect(() =>
      assertStaticPayerAllowed({
        APP_ENV: 'production',
        ARC_PAYMENT_SIGNER_PRIVATE_KEY: key,
      }),
    ).toThrow(/must not be set/);
    for (const APP_ENV of ['development', 'test', 'demo', 'staging'] as const) {
      expect(() =>
        assertStaticPayerAllowed({
          APP_ENV,
          ARC_PAYMENT_SIGNER_PRIVATE_KEY: key,
        }),
      ).not.toThrow();
    }
    expect(() =>
      assertStaticPayerAllowed({
        APP_ENV: 'production',
        ARC_PAYMENT_SIGNER_PRIVATE_KEY: undefined,
      }),
    ).not.toThrow();
  });
});

describe('Gateway settlement status', () => {
  const txHash = `0x${'ab'.repeat(32)}`;

  it('is settled only with a batch transaction, failed when Gateway says so', () => {
    expect(settlementOutcome({ status: 'completed', txHash })).toEqual({
      kind: 'settled',
      txHash,
    });
    expect(settlementOutcome({ status: 'confirmed', txHash })).toEqual({
      kind: 'settled',
      txHash,
    });
    // A "completed" status without a transaction is not proof of settlement.
    expect(settlementOutcome({ status: 'completed', txHash: null })).toEqual({
      kind: 'pending',
    });
    expect(settlementOutcome({ status: 'batched', txHash: null })).toEqual({
      kind: 'pending',
    });
    expect(settlementOutcome({ status: 'failed', txHash: null })).toEqual({
      kind: 'failed',
    });
    expect(settlementOutcome(null)).toEqual({ kind: 'pending' });
  });

  it('reads a transfer from Gateway and rejects odd answers', async () => {
    const respond = (status: number, body: unknown) =>
      createGatewayTransferLookup(testnet!, async () =>
        Response.json(body, { status }),
      );
    expect(
      await respond(200, {
        id: 't1',
        status: 'completed',
        txHash: txHash.toUpperCase().replace('0X', '0x'),
      })('t1'),
    ).toEqual({ status: 'completed', txHash });
    expect(await respond(404, {})('t1')).toBeNull();
    await expect(respond(500, {})('t1')).rejects.toThrow('500');
    await expect(respond(200, { nope: true })('t1')).rejects.toThrow('shape');
    // A malformed tx hash is never treated as a settlement transaction.
    expect(
      await respond(200, { status: 'completed', txHash: '0x123' })('t1'),
    ).toEqual({ status: 'completed', txHash: null });
  });
});
