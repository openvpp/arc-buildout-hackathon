import { keccak256, stringToHex } from 'viem';
import { z } from 'zod';

import { formatUsdcAtomic } from '@/lib/payments/usdc';
import {
  verifyDeviceEvent,
  type VerificationPolicy,
} from '@/server/application/verification/verify-device-event';
import type { DeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import type { GatewayBuyer } from '@/server/infrastructure/payments/gateway';
import {
  decodePaymentRequiredHeader,
  findGatewayRequirements,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '@/server/infrastructure/payments/x402';

/**
 * The milestone 4 M&V agent. It discovers anchored device events, pays a
 * USDC nanopayment (x402, Circle Gateway on Arc) for each one within a
 * budget, then verifies every record it bought against the chain itself —
 * never taking the server's verdict — and reports verified energy and
 * mileage. Unverified records are paid for but excluded from the totals.
 */

const catalogSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    events: z.array(
      z.object({
        eventId: z.string(),
        tokenId: z.string().nullable(),
        eventType: z.number(),
        occurredAt: z.string(),
        contractAddress: z.string().nullable(),
        transactionHash: z.string().nullable(),
        blockNumber: z.string().nullable(),
        priceAtomic: z.string(),
        unlockPath: z.string(),
      }),
    ),
    nextCursor: z.string().nullable(),
    payment: z.object({ network: z.string(), asset: z.string() }),
  }),
});

const specSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    contract: z.object({ address: z.string().nullable() }),
    trustedWriters: z.array(z.string()),
    requiredConfirmations: z.string(),
    maxAnchorDelaySeconds: z.number(),
  }),
});

const unlockedSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    eventId: z.string(),
    alreadyUnlocked: z.boolean(),
    payloadJson: z.string(),
    record: z.object({ json: z.string() }).nullable(),
    receipt: z.object({
      amountAtomic: z.string(),
      settlementReference: z.string(),
    }),
  }),
});

export type AgentEventResult = {
  eventId: string;
  tokenId: string | null;
  eventType: number;
  occurredAt: string;
  paidAtomic: bigint;
  alreadyUnlocked: boolean;
  /** The agent's own verdict from the chain, not the server's. */
  verdict: string;
  failedChecks: string[];
  accepted: boolean;
  energyKwh: number | null;
  distanceMiles: number | null;
  settlementReference: string | null;
};

export type MvReport = {
  baseUrl: string;
  payer: string;
  network: string;
  budgetAtomic: bigint;
  spentAtomic: bigint;
  stoppedBecause: 'done' | 'budget' | 'max_events';
  events: AgentEventResult[];
  totals: {
    bought: number;
    verified: number;
    rejected: number;
    verifiedEnergyKwh: number;
    verifiedDistanceMiles: number;
  };
};

export type MvAgentInput = {
  baseUrl: string;
  budgetAtomic: bigint;
  maxPriceAtomic: bigint;
  maxEvents: number;
  tokenId?: string;
  fetch: typeof fetch;
  buyer: GatewayBuyer;
  reader: DeviceEventChainReader;
  /** Overrides the published spec's trusted writers (no trust in the server). */
  trustedWriters?: readonly string[];
  /** The DeviceNFT contract to accept anchors from (default: the spec's). */
  contractAddress?: string;
  log?: (line: string) => void;
};

function numberField(json: string | null, field: string): number | null {
  if (json === null) return null;
  try {
    const value = (JSON.parse(json) as Record<string, unknown>)[field];
    const parsed = typeof value === 'string' ? Number(value) : value;
    return typeof parsed === 'number' && Number.isFinite(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const response = await fetchImpl(url, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { response, body };
}

export async function runMvAgent(input: MvAgentInput): Promise<MvReport> {
  const log = input.log ?? (() => undefined);
  const base = input.baseUrl.replace(/\/$/, '');

  const spec = specSchema.parse(
    (await getJson(input.fetch, `${base}/api/v1/verify/spec`)).body,
  ).data;
  const policy: VerificationPolicy = {
    requiredConfirmations: BigInt(spec.requiredConfirmations),
    trustedWriters: (input.trustedWriters ?? spec.trustedWriters).map((w) =>
      w.toLowerCase(),
    ),
    maxAnchorDelaySeconds: spec.maxAnchorDelaySeconds,
    clockSkewSeconds: 300,
  };

  const contract = (
    input.contractAddress ?? spec.contract.address
  )?.toLowerCase();
  if (contract === undefined) {
    throw new Error(
      'No DeviceNFT contract to verify against (pass contractAddress).',
    );
  }

  const query = new URLSearchParams({
    limit: String(Math.min(input.maxEvents, 100)),
  });
  if (input.tokenId !== undefined) query.set('tokenId', input.tokenId);
  const catalog = catalogSchema.parse(
    (await getJson(input.fetch, `${base}/api/v1/agent/events?${query}`)).body,
  ).data;
  log(
    `Catalog: ${catalog.events.length} anchored event(s) on ${catalog.payment.network}.`,
  );

  const report: MvReport = {
    baseUrl: base,
    payer: input.buyer.address,
    network: catalog.payment.network,
    budgetAtomic: input.budgetAtomic,
    spentAtomic: 0n,
    stoppedBecause: 'done',
    events: [],
    totals: {
      bought: 0,
      verified: 0,
      rejected: 0,
      verifiedEnergyKwh: 0,
      verifiedDistanceMiles: 0,
    },
  };

  for (const entry of catalog.events) {
    if (report.events.length >= input.maxEvents) {
      report.stoppedBecause = 'max_events';
      break;
    }
    // Only anchors on the pinned contract: the catalog cannot redirect us.
    if (entry.contractAddress?.toLowerCase() !== contract) {
      log(`Skipping ${entry.eventId}: not on contract ${contract}.`);
      continue;
    }
    const url = `${base}${entry.unlockPath}`;
    const quote = await input.fetch(url);
    let paymentHeader: string | null = null;
    let paidAtomic = 0n;
    if (quote.status === 402) {
      const required = decodePaymentRequiredHeader(
        quote.headers.get(PAYMENT_REQUIRED_HEADER) ?? '',
      );
      const option =
        required === null ? null : findGatewayRequirements(required);
      if (required === null || option === null) {
        log(
          `Skipping ${entry.eventId}: no Circle Gateway payment option offered.`,
        );
        continue;
      }
      // Pay only what the catalog advertised, on the advertised network.
      if (
        option.network !== catalog.payment.network ||
        option.asset.toLowerCase() !== catalog.payment.asset.toLowerCase() ||
        BigInt(option.amount) > input.maxPriceAtomic
      ) {
        log(
          `Skipping ${entry.eventId}: the 402 asks for something unexpected.`,
        );
        continue;
      }
      paidAtomic = BigInt(option.amount);
      if (report.spentAtomic + paidAtomic > input.budgetAtomic) {
        report.stoppedBecause = 'budget';
        log(
          `Budget reached (${formatUsdcAtomic(report.spentAtomic)} USDC spent).`,
        );
        break;
      }
      paymentHeader = await input.buyer.createPaymentSignatureHeader(required);
    } else if (!quote.ok) {
      log(`Skipping ${entry.eventId}: ${quote.status}.`);
      continue;
    }

    const paid =
      paymentHeader === null
        ? { response: quote, body: (await quote.json()) as unknown }
        : await getJson(input.fetch, url, {
            headers: { [PAYMENT_SIGNATURE_HEADER]: paymentHeader },
          });
    const unlocked = unlockedSchema.safeParse(paid.body);
    if (!paid.response.ok || !unlocked.success) {
      log(
        `Payment for ${entry.eventId} was refused (${paid.response.status}).`,
      );
      continue;
    }
    const data = unlocked.data.data;
    const charged = data.alreadyUnlocked ? 0n : paidAtomic;
    report.spentAtomic += charged;

    // Independent check: the agent reads the anchor from Arc itself.
    let verdict = 'unverified';
    let failedChecks: string[] = ['chain_unreadable'];
    if (
      entry.blockNumber !== null &&
      entry.transactionHash !== null &&
      entry.contractAddress !== null &&
      entry.tokenId !== null
    ) {
      try {
        const blockNumber = BigInt(entry.blockNumber);
        const [latestBlockNumber, block, logs] = await Promise.all([
          input.reader.latestBlockNumber(),
          input.reader.readBlock(blockNumber),
          input.reader.readDeviceEventLogs({
            contractAddress: entry.contractAddress,
            fromBlock: blockNumber,
            toBlock: blockNumber,
            tokenId: BigInt(entry.tokenId),
          }),
        ]);
        const tx = entry.transactionHash.toLowerCase();
        const result = verifyDeviceEvent(
          {
            contractAddress: entry.contractAddress,
            transactionHash: entry.transactionHash,
            blockNumber,
            tokenId: BigInt(entry.tokenId),
            eventType: entry.eventType,
            payloadHash: keccak256(stringToHex(data.payloadJson)),
            payloadJson: data.payloadJson,
            earliestAnchorAt: null,
            // The salt stays with the owner; an agent checks the payload.
            record: { kind: 'none' },
          },
          {
            latestBlockNumber,
            block:
              block === null
                ? null
                : { number: block.number, timestamp: block.timestamp },
            transactionSender: block?.senderOf(entry.transactionHash) ?? null,
            logs: logs.filter((l) => l.transactionHash.toLowerCase() === tx),
          },
          policy,
        );
        verdict = result.verdict;
        failedChecks = result.checks
          .filter((c) => c.status === 'fail')
          .map((c) => c.id);
      } catch (error) {
        log(
          `Could not read the anchor of ${entry.eventId} from Arc: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    // Lateness alone (a warning) does not make the data untrue.
    const accepted =
      verdict === 'verified' || verdict === 'verified_with_warnings';
    // Energy counted as verified is the anchored payload field. The paid
    // record can carry a different figure, and the agent does not hold the
    // salt, so that figure is not checked against recordHash.
    const energyKwh =
      entry.eventType === 2
        ? numberField(data.payloadJson, 'energyDelivered')
        : null;
    const distanceMiles =
      entry.eventType === 12
        ? numberField(data.payloadJson, 'distanceTraveled')
        : null;

    report.events.push({
      eventId: entry.eventId,
      tokenId: entry.tokenId,
      eventType: entry.eventType,
      occurredAt: entry.occurredAt,
      paidAtomic: charged,
      alreadyUnlocked: data.alreadyUnlocked,
      verdict,
      failedChecks,
      accepted,
      energyKwh,
      distanceMiles,
      settlementReference: data.receipt.settlementReference,
    });
    report.totals.bought += 1;
    if (accepted) {
      report.totals.verified += 1;
      report.totals.verifiedEnergyKwh += energyKwh ?? 0;
      report.totals.verifiedDistanceMiles += distanceMiles ?? 0;
    } else {
      report.totals.rejected += 1;
    }
    log(
      `${entry.eventId}: paid ${formatUsdcAtomic(charged)} USDC, chain verdict ${verdict}${accepted ? '' : ' — excluded'}.`,
    );
  }
  return report;
}

/** A short, human-readable M&V report. */
export function formatMvReport(report: MvReport): string {
  const lines = [
    '# M&V agent report',
    '',
    `- Server: ${report.baseUrl}`,
    `- Payer: ${report.payer} on ${report.network}`,
    `- Spent: ${formatUsdcAtomic(report.spentAtomic)} of ${formatUsdcAtomic(report.budgetAtomic)} USDC (${report.stoppedBecause === 'budget' ? 'stopped at budget' : report.stoppedBecause === 'max_events' ? 'stopped at event limit' : 'catalog done'})`,
    `- Records bought: ${report.totals.bought}; verified on Arc by the agent: ${report.totals.verified}; rejected: ${report.totals.rejected}`,
    `- Verified energy (anchored payload): ${report.totals.verifiedEnergyKwh.toFixed(3)} kWh`,
    `- Verified distance: ${report.totals.verifiedDistanceMiles.toFixed(1)} mi`,
    '',
    '| Event | Token | Type | Paid (USDC) | Chain verdict | Energy (kWh) | Miles |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...report.events.map(
      (e) =>
        `| ${e.eventId.slice(0, 8)} | ${e.tokenId ?? '—'} | ${e.eventType === 2 ? 'charging' : e.eventType === 12 ? 'daily' : e.eventType} | ${formatUsdcAtomic(e.paidAtomic)}${e.alreadyUnlocked ? ' (owned)' : ''} | ${e.verdict}${e.failedChecks.length > 0 ? ` (${e.failedChecks.join(', ')})` : ''} | ${e.energyKwh ?? '—'} | ${e.distanceMiles ?? '—'} |`,
    ),
    '',
    "Verification proves the public payload is anchored by a trusted writer, unchanged and timely. The private record's recordHash is not checked, because the salt stays with the owner. It does not prove the measurement is true.",
  ];
  return lines.join('\n');
}
