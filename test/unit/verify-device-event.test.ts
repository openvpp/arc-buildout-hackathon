import { readFileSync } from 'node:fs';

import { keccak256, stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  findDailySeriesGaps,
  verifyDeviceEvent,
  type ChainObservation,
  type ExpectedEvent,
  type VerificationPolicy,
} from '@/server/application/verification/verify-device-event';
import { CHECK_IDS } from '@/lib/verification/vocabulary';
import {
  DEVICE_EVENT_SIGNATURE,
  DEVICE_EVENT_TOPIC0,
} from '@/server/infrastructure/blockchain/device-nft-abi';
import { decideOutboxFollowUp } from '@/server/infrastructure/jobs/outbox-follow-up';

const CONTRACT = '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908';
const WRITER = '0x0e12c056a563c7ebc652e288e09c9be524044cea';
const TX = `0x${'ab'.repeat(32)}`;
const RECORD_HASH = `0x${'11'.repeat(32)}`;
// The anchored payload states the activity end; the block is 10 min later.
const ACTIVITY_END = '2026-10-12T17:00:00.000Z';
const BLOCK_TIME = BigInt(Date.parse('2026-10-12T17:10:00Z') / 1000);

function payloadText(
  fields: { endTime?: string; recordHash?: string; energy?: number } = {},
): string {
  return JSON.stringify({
    vehicleId: 'v1',
    energyDelivered: fields.energy ?? 30,
    endTime: fields.endTime ?? ACTIVITY_END,
    ...(fields.recordHash === undefined
      ? {}
      : { recordHash: fields.recordHash }),
  });
}

const PAYLOAD = payloadText();
const PAYLOAD_HASH = keccak256(stringToHex(PAYLOAD));

const policy: VerificationPolicy = {
  requiredConfirmations: 3n,
  trustedWriters: [WRITER],
  maxAnchorDelaySeconds: 48 * 3600,
  clockSkewSeconds: 300,
};

function expected(overrides: Partial<ExpectedEvent> = {}): ExpectedEvent {
  return {
    contractAddress: CONTRACT,
    transactionHash: TX,
    blockNumber: 100n,
    tokenId: 82n,
    eventType: 2,
    payloadHash: PAYLOAD_HASH,
    payloadJson: PAYLOAD,
    earliestAnchorAt: null,
    record: { kind: 'none' },
    ...overrides,
  };
}

function logOf(
  payload: string,
  overrides: { logIndex?: number; tokenId?: bigint } = {},
) {
  return {
    contractAddress: CONTRACT.toLowerCase(),
    transactionHash: TX,
    logIndex: overrides.logIndex ?? 0,
    tokenId: overrides.tokenId ?? 82n,
    eventType: 2,
    dataHash: keccak256(stringToHex(payload)),
    dataUtf8: payload,
  };
}

function observed(overrides: Partial<ChainObservation> = {}): ChainObservation {
  return {
    latestBlockNumber: 200n,
    block: { number: 100n, timestamp: BLOCK_TIME },
    transactionSender: WRITER,
    logs: [logOf(PAYLOAD)],
    ...overrides,
  };
}

/** Expected + observed for an anchored v2 payload with this content. */
function anchoredV2(payload: string, recomputedHash: string | null) {
  return {
    expected: expected({
      payloadJson: payload,
      payloadHash: keccak256(stringToHex(payload)),
      record: {
        kind: 'commitment',
        recomputedHash,
        problem:
          recomputedHash === null ? 'the source record was deleted' : null,
      },
    }),
    observed: observed({ logs: [logOf(payload)] }),
  };
}

const statusOf = (result: ReturnType<typeof verifyDeviceEvent>, id: string) =>
  result.checks.find((check) => check.id === id)?.status;

describe('verifyDeviceEvent', () => {
  it('verifies an anchored, final, untampered, timely record', () => {
    const result = verifyDeviceEvent(expected(), observed(), policy);
    expect(result.verdict).toBe('verified');
    expect(statusOf(result, 'record_commitment')).toBe('skip');
    expect(result.evidence).toMatchObject({
      blockNumber: '100',
      confirmations: '101',
      transactionSender: WRITER,
    });
  });

  it('is pending until final', () => {
    const result = verifyDeviceEvent(
      expected(),
      observed({ latestBlockNumber: 101n }),
      policy,
    );
    expect(result.verdict).toBe('pending');
    expect(statusOf(result, 'finality')).toBe('pending');
  });

  it('rejects an anchor that is missing from the stated block', () => {
    const result = verifyDeviceEvent(
      expected(),
      observed({ logs: [] }),
      policy,
    );
    expect(result.verdict).toBe('unverified');
    expect(statusOf(result, 'anchor_exists')).toBe('fail');
  });

  it('rejects an anchor written by an unrecognized UPDATER_ROLE holder', () => {
    const result = verifyDeviceEvent(
      expected(),
      observed({
        transactionSender: '0x000000000000000000000000000000000000dEaD',
      }),
      policy,
    );
    expect(result.verdict).toBe('unverified');
    expect(statusOf(result, 'authorized_writer')).toBe('fail');
  });

  it('rejects a different token or event type', () => {
    const result = verifyDeviceEvent(
      expected({ tokenId: 83n }),
      observed(),
      policy,
    );
    expect(statusOf(result, 'device_and_type')).toBe('fail');
    expect(result.verdict).toBe('unverified');
  });

  it('does not claim a device match when no device was expected', () => {
    const result = verifyDeviceEvent(
      expected({ tokenId: null, eventType: null }),
      observed(),
      policy,
    );
    expect(statusOf(result, 'device_and_type')).toBe('skip');
    expect(
      verifyDeviceEvent(
        expected({ tokenId: null, eventType: 12 }),
        observed(),
        policy,
      ).verdict,
    ).toBe('unverified');
  });

  it('picks the log carrying these bytes in a multi-event transaction', () => {
    const other = payloadText({ energy: 99 });
    const result = verifyDeviceEvent(
      expected(),
      observed({
        logs: [
          logOf(other, { logIndex: 0, tokenId: 82n }),
          logOf(PAYLOAD, { logIndex: 1, tokenId: 82n }),
        ],
      }),
      policy,
    );
    expect(result.verdict).toBe('verified');
    expect(result.evidence.logIndex).toBe(1);
  });

  it('rejects a stored record that no longer matches the chain', () => {
    const tampered = PAYLOAD.replace('30', '45');
    const result = verifyDeviceEvent(
      expected({
        payloadJson: tampered,
        payloadHash: keccak256(stringToHex(tampered)),
      }),
      observed(),
      policy,
    );
    expect(statusOf(result, 'content_hash')).toBe('fail');
    expect(statusOf(result, 'stored_payload')).toBe('fail');
    expect(result.verdict).toBe('unverified');
  });

  it('checks the full off-chain record against the anchored recordHash', () => {
    const payload = payloadText({ recordHash: RECORD_HASH });
    const good = anchoredV2(payload, RECORD_HASH);
    expect(
      statusOf(
        verifyDeviceEvent(good.expected, good.observed, policy),
        'record_commitment',
      ),
    ).toBe('pass');

    const changed = anchoredV2(payload, `0x${'22'.repeat(32)}`);
    const changedResult = verifyDeviceEvent(
      changed.expected,
      changed.observed,
      policy,
    );
    expect(statusOf(changedResult, 'record_commitment')).toBe('fail');
    expect(changedResult.verdict).toBe('unverified');

    const deleted = anchoredV2(payload, null);
    expect(
      verifyDeviceEvent(deleted.expected, deleted.observed, policy).verdict,
    ).toBe('unverified');
  });

  it('fails a v2 record whose anchored payload has no recordHash', () => {
    const { expected: exp, observed: obs } = anchoredV2(PAYLOAD, RECORD_HASH);
    const result = verifyDeviceEvent(exp, obs, policy);
    expect(statusOf(result, 'record_commitment')).toBe('fail');
  });

  it('takes the activity time from the anchored payload', () => {
    const late = payloadText({ endTime: '2026-10-09T17:00:00.000Z' });
    const lateResult = verifyDeviceEvent(
      expected({
        payloadJson: late,
        payloadHash: keccak256(stringToHex(late)),
      }),
      observed({ logs: [logOf(late)] }),
      policy,
    );
    expect(lateResult.verdict).toBe('verified_with_warnings');
    expect(statusOf(lateResult, 'anchor_timeliness')).toBe('warn');

    const backdated = payloadText({ endTime: '2026-10-13T17:00:00.000Z' });
    const backdatedResult = verifyDeviceEvent(
      expected({
        payloadJson: backdated,
        payloadHash: keccak256(stringToHex(backdated)),
      }),
      observed({ logs: [logOf(backdated)] }),
      policy,
    );
    expect(backdatedResult.verdict).toBe('unverified');
    expect(statusOf(backdatedResult, 'anchor_timeliness')).toBe('fail');
  });

  it('measures a record held for its mint from the mint', () => {
    const old = payloadText({ endTime: '2026-10-09T17:00:00.000Z' });
    const held = {
      payloadJson: old,
      payloadHash: keccak256(stringToHex(old)),
    };
    const minted = verifyDeviceEvent(
      expected({ ...held, earliestAnchorAt: new Date('2026-10-12T16:00:00Z') }),
      observed({ logs: [logOf(old)] }),
      policy,
    );
    expect(statusOf(minted, 'anchor_timeliness')).toBe('pass');

    const slowAfterMint = verifyDeviceEvent(
      expected({ ...held, earliestAnchorAt: new Date('2026-10-09T18:00:00Z') }),
      observed({ logs: [logOf(old)] }),
      policy,
    );
    expect(statusOf(slowAfterMint, 'anchor_timeliness')).toBe('warn');
  });

  it('never records "verified" when the anchor block is absent', () => {
    const result = verifyDeviceEvent(
      expected(),
      observed({ block: null }),
      policy,
    );
    expect(result.verdict).toBe('unverified');
  });
});

describe('findDailySeriesGaps', () => {
  it('flags days with readings that were neither published nor explained', () => {
    expect(
      findDailySeriesGaps({
        datesWithReadings: [
          '2026-10-01',
          '2026-10-02',
          '2026-10-03',
          '2026-10-04',
        ],
        publishedDates: ['2026-10-01', '2026-10-03'],
        explainedDates: ['2026-10-04'],
      }),
    ).toEqual(['2026-10-02']);
  });

  it('does not treat silent days as gaps', () => {
    expect(
      findDailySeriesGaps({
        datesWithReadings: ['2026-10-01', '2026-10-05'],
        publishedDates: ['2026-10-01', '2026-10-05'],
        explainedDates: [],
      }),
    ).toEqual([]);
  });
});

describe('verification job follow-up', () => {
  it('completes once checked and re-checks soon while not final', () => {
    const base = {
      attempts: 0,
      maxAttempts: 5,
      hasInFlightTransaction: false,
      errorMessage: null,
    };
    expect(decideOutboxFollowUp({ ...base, outcome: 'checked' })).toEqual({
      action: 'complete',
    });
    expect(
      decideOutboxFollowUp({ ...base, outcome: 'not_final' }),
    ).toMatchObject({ action: 'reschedule', attempts: 0 });
  });
});

describe('single sources of truth', () => {
  it('runs every check in CHECK_IDS order', () => {
    const result = verifyDeviceEvent(expected(), observed(), policy);
    expect(result.checks.map((check) => check.id)).toEqual([...CHECK_IDS]);
  });

  it('derives the DeviceEvent signature and topic0 from DEVICE_NFT_ABI', () => {
    expect(DEVICE_EVENT_SIGNATURE).toBe(
      'DeviceEvent(uint256 indexed tokenId, uint8 indexed eventType, bytes data, uint256 timestamp)',
    );
    expect(DEVICE_EVENT_TOPIC0).toBe(
      '0x3de799dd7abe8fd56ddf6376287c6702888d24fbc26726a7d9bbfab1c3c53962',
    );
  });

  it('keeps the standalone script (deliberately self-contained) in sync', () => {
    const script = readFileSync('scripts/verify-standalone.ts', 'utf8');
    expect(script).toContain(`'event ${DEVICE_EVENT_SIGNATURE}'`);
  });
});
