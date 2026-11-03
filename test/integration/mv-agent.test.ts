import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { keccak256, stringToHex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

import { runMvAgent } from '@/agent/mv-agent';
import { GET as eventGET } from '@/app/api/v1/agent/events/[eventId]/route';
import { GET as catalogGET } from '@/app/api/v1/agent/events/route';
import { GET as specGET } from '@/app/api/v1/verify/spec/route';
import { getServerEnv } from '@/server/config/env';
import type { DeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import { deviceEvents, devices } from '@/server/infrastructure/db/schema';
import { resetRateLimitsForTests } from '@/server/transport/http/rate-limit';
import { createMockGatewayBuyer } from '@/server/infrastructure/payments/mock-gateway';

import { createTestDb, insertTestWallet } from './test-helpers';

const { db, sql } = createTestDb();

afterAll(async () => {
  await sql.end();
});

const env = getServerEnv();
const CONTRACT = env.DEVICE_NFT_CONTRACT_ADDRESS ?? '';
const WRITER = env.ARC_TRUSTED_WRITER_ADDRESSES;
const BASE = 'http://agent.test';

/** The agent's HTTP calls, served in-process by the real route handlers. */
const inProcessFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const request = new NextRequest(url, {
    ...(init?.method !== undefined ? { method: init.method } : {}),
    ...(init?.headers !== undefined ? { headers: init.headers } : {}),
  });
  if (url.pathname === '/api/v1/verify/spec') return specGET(request);
  if (url.pathname === '/api/v1/agent/events') return catalogGET(request);
  const match = /^\/api\/v1\/agent\/events\/([^/]+)$/.exec(url.pathname);
  if (match?.[1] !== undefined) {
    return eventGET(request, {
      params: Promise.resolve({ eventId: match[1] }),
    });
  }
  return new Response('not found', { status: 404 });
};

type Seeded = {
  id: string;
  tx: string;
  block: bigint;
  payload: string;
  tampered: boolean;
};

async function seed(): Promise<Seeded[]> {
  const { wallet } = await insertTestWallet(db, {
    address: `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`,
    circleWalletId: randomUUID(),
  });
  const [device] = await db
    .insert(devices)
    .values({
      walletId: wallet.id,
      provider: 'enode',
      externalDeviceId: randomUUID(),
      mintStatus: 'minted',
      nftTokenId: '42',
    })
    .returning();
  const seeded: Seeded[] = [];
  for (const [i, tampered] of [false, false, true].entries()) {
    const endTime = new Date(Date.UTC(2031, 7, 1 + i, 12)).toISOString();
    const payload = JSON.stringify({
      vehicleId: device!.id,
      energyDelivered: 30,
      endTime,
    });
    const tx = `0x${randomUUID().replace(/-/g, '')}${'0'.repeat(32)}`;
    const block = BigInt(1000 + i);
    const [event] = await db
      .insert(deviceEvents)
      .values({
        deviceId: device!.id,
        eventType: 2,
        sourceType: 'charging_session',
        sourceId: randomUUID(),
        occurredAt: new Date(endTime),
        payloadJson: payload,
        payloadHash: keccak256(stringToHex(payload)),
        status: 'confirmed',
        transactionHash: tx,
        tokenId: '42',
        contractAddress: CONTRACT,
        chainId: 5042002n,
        blockNumber: block,
        confirmedAt: new Date(),
      })
      .returning();
    seeded.push({ id: event!.id, tx, block, payload, tampered });
  }
  return seeded;
}

/** A chain holding the seeded anchors; the tampered one has other bytes. */
function chainFor(seeded: Seeded[]): DeviceEventChainReader {
  return {
    chainId: 5042002n,
    rpcHost: 'rpc.test',
    latestBlockNumber: async () => 5000n,
    readBlock: async (number) => {
      const anchor = seeded.find((s) => s.block === number);
      return {
        number,
        timestamp: BigInt(
          Math.floor(
            Date.UTC(2031, 7, 1 + Number(number - 1000n), 12, 5) / 1000,
          ),
        ),
        senderOf: (hash) =>
          anchor !== undefined && hash.toLowerCase() === anchor.tx
            ? WRITER
            : null,
      };
    },
    readDeviceEventLogs: async ({ fromBlock }) =>
      seeded
        .filter((s) => s.block === fromBlock)
        .map((s) => {
          const onChain = s.tampered
            ? s.payload.replace('30', '45')
            : s.payload;
          return {
            contractAddress: CONTRACT,
            blockNumber: s.block,
            transactionHash: s.tx,
            logIndex: 0,
            tokenId: 42n,
            eventType: 2,
            dataHash: keccak256(stringToHex(onChain)),
            dataUtf8: onChain,
            eventTimestamp: 0n,
          };
        }),
    findTransactionBlock: async () => null,
  };
}

describe('M&V agent (end to end, in-process)', () => {
  it('pays per event, verifies each on-chain itself, excludes tampered data', async () => {
    resetRateLimitsForTests();
    const seeded = await seed();
    const buyer = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e7',
    });
    const report = await runMvAgent({
      baseUrl: BASE,
      budgetAtomic: 10_000n,
      maxPriceAtomic: 1000n,
      maxEvents: 10,
      tokenId: '42',
      fetch: inProcessFetch,
      buyer,
      reader: chainFor(seeded),
    });
    expect(report.spentAtomic).toBe(3000n);
    expect(report.totals).toEqual({
      bought: 3,
      verified: 2,
      rejected: 1,
      verifiedEnergyKwh: 60,
      verifiedDistanceMiles: 0,
    });
    const tampered = report.events.find((e) => e.eventId === seeded[2]?.id);
    expect(tampered).toMatchObject({ accepted: false, verdict: 'unverified' });
    expect(tampered?.failedChecks).toContain('content_hash');

    // Running again: everything is already owned, nothing is charged.
    const again = await runMvAgent({
      baseUrl: BASE,
      budgetAtomic: 10_000n,
      maxPriceAtomic: 1000n,
      maxEvents: 10,
      tokenId: '42',
      fetch: inProcessFetch,
      buyer,
      reader: chainFor(seeded),
    });
    expect(again.spentAtomic).toBe(0n);
    expect(again.events.every((e) => e.alreadyUnlocked)).toBe(true);
  });

  it('stops at its budget and refuses an unexpected price', async () => {
    resetRateLimitsForTests();
    const seeded = await seed();
    const buyer = createMockGatewayBuyer({
      address: '0x000000000000000000000000000000000000a9e8',
    });
    const capped = await runMvAgent({
      baseUrl: BASE,
      budgetAtomic: 1000n,
      maxPriceAtomic: 1000n,
      maxEvents: 10,
      tokenId: '42',
      fetch: inProcessFetch,
      buyer,
      reader: chainFor(seeded),
    });
    expect(capped.spentAtomic).toBe(1000n);
    expect(capped.stoppedBecause).toBe('budget');

    const stingy = await runMvAgent({
      baseUrl: BASE,
      budgetAtomic: 10_000n,
      maxPriceAtomic: 999n,
      maxEvents: 10,
      tokenId: '42',
      fetch: inProcessFetch,
      buyer: createMockGatewayBuyer({
        address: '0x000000000000000000000000000000000000a9e9',
      }),
      reader: chainFor(seeded),
    });
    expect(stingy.spentAtomic).toBe(0n);
    expect(stingy.events).toHaveLength(0);
  });

  it('only buys anchors on the pinned contract', async () => {
    resetRateLimitsForTests();
    const seeded = await seed();
    const report = await runMvAgent({
      baseUrl: BASE,
      budgetAtomic: 10_000n,
      maxPriceAtomic: 1000n,
      maxEvents: 10,
      tokenId: '42',
      fetch: inProcessFetch,
      buyer: createMockGatewayBuyer({
        address: '0x000000000000000000000000000000000000a9ea',
      }),
      reader: chainFor(seeded),
      contractAddress: '0x000000000000000000000000000000000000dead',
    });
    expect(report.events).toHaveLength(0);
    expect(report.spentAtomic).toBe(0n);
  });

  it('answers an unpaid request with 402 and a PAYMENT-REQUIRED header', async () => {
    resetRateLimitsForTests();
    const [first] = await seed();
    const response = await inProcessFetch(
      `${BASE}/api/v1/agent/events/${first!.id}`,
    );
    expect(response.status).toBe(402);
    expect(response.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    const body = (await response.json()) as {
      paymentRequired: { accepts: { amount: string }[] };
    };
    expect(body.paymentRequired.accepts[0]?.amount).toBe('1000');
  });
});
