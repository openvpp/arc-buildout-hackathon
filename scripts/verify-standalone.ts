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
 *     [--writer 0x…[,0x…]] [--confirmations 3] \
 *     [--record-file record.json --salt 0x…]   # payload v2 private check
 *
 * Exit code 0 = verified, 1 = unverified, 2 = pending, 3 = usage error.
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

type Status = 'PASS' | 'FAIL' | 'PENDING' | 'SKIP';

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
  const log = logs.find((entry) => entry.transactionHash?.toLowerCase() === tx);
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
      `Sender ${sender ?? 'unknown'}; pass --writer to check it`,
    ]);
  } else {
    results.push([
      'authorized_writer',
      sender !== undefined && writers.includes(sender) ? 'PASS' : 'FAIL',
      `Sender ${sender ?? 'not found in block'}`,
    ]);
  }

  const data = log?.args.data;
  if (data === undefined) {
    results.push(['content_hash', 'SKIP', 'No anchor']);
  } else {
    const expected = keccak256(stringToHex(payload));
    results.push([
      'content_hash',
      keccak256(data) === expected ? 'PASS' : 'FAIL',
      `on-chain ${keccak256(data)}, yours ${expected}`,
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
      : 'VERIFIED';
  process.stdout.write(`\n=> ${verdict}\n`);
  return verdict === 'VERIFIED' ? 0 : verdict === 'PENDING' ? 2 : 1;
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
