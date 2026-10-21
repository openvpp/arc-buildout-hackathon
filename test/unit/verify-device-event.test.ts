import { keccak256, stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  findDailySeriesGaps,
  verifyDeviceEvent,
  type ChainObservation,
  type ExpectedEvent,
  type VerificationPolicy,
} from '@/server/application/verification/verify-device-event';
import { decideOutboxFollowUp } from '@/server/infrastructure/jobs/outbox-follow-up';

const CONTRACT = '0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908';
const WRITER = '0x0e12c056a563c7ebc652e288e09c9be524044cea';
const TX = `0x${'ab'.repeat(32)}`;
const PAYLOAD = '{"vehicleId":"v1","energyDelivered":30}';
const PAYLOAD_HASH = keccak256(stringToHex(PAYLOAD));
// Activity ended 10 minutes before the anchoring block.
const ACTIVITY_END = new Date('2026-10-12T17:00:00Z');
const BLOCK_TIME = BigInt(Date.parse('2026-10-12T17:10:00Z') / 1000);

const policy: VerificationPolicy = {
  requiredConfirmations: 3n,
  trustedWriters: [WRITER],
  maxAnchorDelaySeconds: 24 * 3600,
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
    occurredAt: ACTIVITY_END,
    record: { kind: 'none' },
    ...overrides,
  };
}

function observed(overrides: Partial<ChainObservation> = {}): ChainObservation {
  return {
    latestBlockNumber: 200n,
    block: { number: 100n, timestamp: BLOCK_TIME },
    transactionSender: WRITER,
    logs: [
      {
        contractAddress: CONTRACT.toLowerCase(),
        transactionHash: TX,
        logIndex: 0,
        tokenId: 82n,
        eventType: 2,
        dataHash: PAYLOAD_HASH,
        dataUtf8: PAYLOAD,
      },
    ],
    ...overrides,
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

  it('checks the full off-chain record for payload version 2', () => {
    const committed = `0x${'11'.repeat(32)}`;
    const good = verifyDeviceEvent(
      expected({
        record: {
          kind: 'commitment',
          committedHash: committed,
          recomputedHash: committed,
          problem: null,
        },
      }),
      observed(),
      policy,
    );
    expect(statusOf(good, 'record_commitment')).toBe('pass');

    const changed = verifyDeviceEvent(
      expected({
        record: {
          kind: 'commitment',
          committedHash: committed,
          recomputedHash: `0x${'22'.repeat(32)}`,
          problem: null,
        },
      }),
      observed(),
      policy,
    );
    expect(statusOf(changed, 'record_commitment')).toBe('fail');
    expect(changed.verdict).toBe('unverified');

    const deleted = verifyDeviceEvent(
      expected({
        record: {
          kind: 'commitment',
          committedHash: committed,
          recomputedHash: null,
          problem: 'the source record was deleted',
        },
      }),
      observed(),
      policy,
    );
    expect(deleted.verdict).toBe('unverified');
  });

  it('warns on a late anchor and rejects one that predates its activity', () => {
    const late = verifyDeviceEvent(
      expected({ occurredAt: new Date('2026-10-09T17:00:00Z') }),
      observed(),
      policy,
    );
    expect(late.verdict).toBe('verified_with_warnings');
    expect(statusOf(late, 'anchor_timeliness')).toBe('warn');

    const backdated = verifyDeviceEvent(
      expected({ occurredAt: new Date('2026-10-13T17:00:00Z') }),
      observed(),
      policy,
    );
    expect(backdated.verdict).toBe('unverified');
    expect(statusOf(backdated, 'anchor_timeliness')).toBe('fail');
  });

  it('fails closed when the block cannot be read', () => {
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
