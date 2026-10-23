/**
 * Standalone verifier for a DeviceNFT event — depends only on `viem` and a
 * public Arc RPC, never on this app's server or database. Copy it anywhere.
 * Implements docs/verification-spec.md.
 *
 *   pnpm verify:standalone -- \
 *     --rpc https://rpc.testnet.arc.io \
 *     --contract 0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908 \
 *     --tx 0x… --block 66862991 \
 *     --payload '{"vehicleId":…}' \
 *     --writer 0x…[,0x…] \
 *     [--token-id 82 --event-type 2] [--confirmations 3] \
 *     [--max-delay-hours 48] \
 *     [--record-file record.json --salt 0x…]   # payload v2 private check
 *
 * Exit code 0 = verified (warnings are printed), 1 = unverified,
 * 2 = pending, 3 = usage error, 4 = incomplete (no --writer: the sender was
 * not checked, so the anchor is not attributable).
 */
import { readFileSync } from 'node:fs';

import {
  createPublicClient,
  hexToString,
  http,
  keccak256,
  parseAbiItem,
  stringToHex,
} from 'viem';

const DEVICE_EVENT = parseAbiItem(
  'event DeviceEvent(uint256 indexed tokenId, uint8 indexed eventType, bytes data, uint256 timestamp)',
);

type Status = 'PASS' | 'FAIL' | 'PENDING' | 'WARN' | 'SKIP';

/** Allowed clock skew before an anchor counts as predating its activity. */
const CLOCK_SKEW_SECONDS = 300n;

/**
 * Arc's public RPC sits behind nodes with different history retention, so
 * an old-block read can fail with "requested data not available" on one
 * node and succeed on the next. Retry a few times before giving up.
 */
async function withRetry<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name: string): string {
  const value = flag(name);
  if (value === undefined || value.length === 0) {
    process.stderr.write(
      `Missing ${name}. See the usage at the top of this file.\n`,
    );
    process.exit(3);
  }
  return value;
}

async function main(): Promise<number> {
  const rpc = required('--rpc');
  const contract = required('--contract').toLowerCase();
  const tx = required('--tx').toLowerCase();
  const blockNumber = BigInt(required('--block'));
  const payload = required('--payload');
  const writers = (flag('--writer') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  const confirmationsRequired = BigInt(flag('--confirmations') ?? '3');
  const expectedTokenId = flag('--token-id');
  const expectedEventType = flag('--event-type');
  const maxDelaySeconds =
    BigInt(Math.round(Number(flag('--max-delay-hours') ?? '48'))) * 3600n;
  const recordFile = flag('--record-file');
  const salt = flag('--salt');

  const client = createPublicClient({ transport: http(rpc) });
  const latest = await withRetry(() => client.getBlockNumber());
  const block = await withRetry(() =>
    client.getBlock({ blockNumber, includeTransactions: true }),
  );
  const logs = await withRetry(() =>
    client.getLogs({
      address: contract as `0x${string}`,
      event: DEVICE_EVENT,
      fromBlock: blockNumber,
      toBlock: blockNumber,
    }),
  );

  const results: [string, Status, string][] = [];
  const payloadHash = keccak256(stringToHex(payload));
  // A transaction can carry several DeviceEvents: check the one with your
  // bytes (falling back to the first, so a mismatch is reported).
  const txLogs = logs.filter(
    (entry) => entry.transactionHash?.toLowerCase() === tx,
  );
  const log =
    txLogs.find(
      (entry) =>
        entry.args.data !== undefined &&
        keccak256(entry.args.data) === payloadHash,
    ) ?? txLogs[0];
  results.push(
    log === undefined
      ? [
          'anchor_exists',
          'FAIL',
          `No DeviceEvent from ${contract} in ${tx} at block ${blockNumber}`,
        ]
      : [
          'anchor_exists',
          'PASS',
          `Found at block ${blockNumber}, log ${log.logIndex}`,
        ],
  );

  const confirmations = latest - blockNumber + 1n;
  results.push([
    'finality',
    confirmations >= confirmationsRequired ? 'PASS' : 'PENDING',
    `${confirmations} confirmations (need ${confirmationsRequired})`,
  ]);

  const sender = block.transactions
    .find((entry) => entry.hash.toLowerCase() === tx)
    ?.from.toLowerCase();
  if (writers.length === 0) {
    results.push([
      'authorized_writer',
      'SKIP',
      `Sender ${sender ?? 'unknown'}; pass --writer (from /api/v1/verify/spec) to check it`,
    ]);
  } else {
    results.push([
      'authorized_writer',
      sender !== undefined && writers.includes(sender) ? 'PASS' : 'FAIL',
      `Sender ${sender ?? 'not found in block'}`,
    ]);
  }

  if (log === undefined) {
    results.push(['device_and_type', 'SKIP', 'No anchor']);
  } else if (expectedTokenId === undefined && expectedEventType === undefined) {
    results.push([
      'device_and_type',
      'SKIP',
      `Token ${log.args.tokenId}, type ${log.args.eventType}; pass --token-id/--event-type to check it`,
    ]);
  } else {
    const tokenOk =
      expectedTokenId === undefined ||
      log.args.tokenId === BigInt(expectedTokenId);
    const typeOk =
      expectedEventType === undefined ||
      log.args.eventType === Number(expectedEventType);
    results.push([
      'device_and_type',
      tokenOk && typeOk ? 'PASS' : 'FAIL',
      `on-chain token ${log.args.tokenId} / type ${log.args.eventType}`,
    ]);
  }

  const data = log?.args.data;
  if (data === undefined) {
    results.push(['content_hash', 'SKIP', 'No anchor']);
  } else {
    results.push([
      'content_hash',
      keccak256(data) === payloadHash ? 'PASS' : 'FAIL',
      `on-chain ${keccak256(data)}, yours ${payloadHash}`,
    ]);
  }

  // Timeliness, from the anchored bytes' own endTime.
  let endTime: unknown;
  try {
    endTime =
      data === undefined
        ? undefined
        : (JSON.parse(hexToString(data)) as { endTime?: unknown }).endTime;
  } catch {
    endTime = undefined;
  }
  const endMs = typeof endTime === 'string' ? Date.parse(endTime) : NaN;
  if (Number.isNaN(endMs)) {
    results.push(['anchor_timeliness', 'SKIP', 'No endTime in anchored data']);
  } else {
    const delay = block.timestamp - BigInt(Math.floor(endMs / 1000));
    results.push([
      'anchor_timeliness',
      delay < -CLOCK_SKEW_SECONDS
        ? 'FAIL'
        : delay > maxDelaySeconds
          ? 'WARN'
          : 'PASS',
      delay < 0n
        ? `Anchored ${-delay} s before the activity end`
        : `Anchored ${delay} s after the activity end${delay > maxDelaySeconds ? ' (late; a record held for its mint can be legitimately late)' : ''}`,
    ]);
  }

  if (recordFile !== undefined && salt !== undefined && data !== undefined) {
    let recordHash: unknown;
    try {
      recordHash = (JSON.parse(hexToString(data)) as { recordHash?: unknown })
        .recordHash;
    } catch {
      recordHash = undefined;
    }
    const recordJson = readFileSync(recordFile, 'utf8');
    const computed = keccak256(stringToHex(`${salt}:${recordJson}`));
    results.push([
      'record_commitment',
      typeof recordHash === 'string' && recordHash === computed
        ? 'PASS'
        : 'FAIL',
      typeof recordHash === 'string'
        ? `anchored ${recordHash}, computed ${computed}`
        : 'Anchored payload has no recordHash (payload v1)',
    ]);
  }

  for (const [id, status, detail] of results) {
    process.stdout.write(`${status.padEnd(8)}${id.padEnd(20)}${detail}\n`);
  }
  const statuses = results.map(([, status]) => status);
  const verdict = statuses.includes('FAIL')
    ? 'UNVERIFIED'
    : statuses.includes('PENDING')
      ? 'PENDING'
      : writers.length === 0
        ? 'INCOMPLETE'
        : statuses.includes('WARN')
          ? 'VERIFIED_WITH_WARNINGS'
          : 'VERIFIED';
  process.stdout.write(`\n=> ${verdict}\n`);
  if (verdict === 'INCOMPLETE') {
    process.stdout.write(
      'The sender was not checked against trusted writers; pass --writer.\n',
    );
  }
  const exitCodes: Record<typeof verdict, number> = {
    VERIFIED: 0,
    VERIFIED_WITH_WARNINGS: 0,
    UNVERIFIED: 1,
    PENDING: 2,
    INCOMPLETE: 4,
  };
  return exitCodes[verdict];
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 3;
  });
