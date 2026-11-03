/**
 * Milestone 4 autonomous M&V agent.
 *
 *   pnpm agent:mv -- [--base-url http://localhost:3000] [--budget 0.01]
 *     [--max-price 0.001] [--max-events 10] [--token-id 82] [--out report.json]
 *     [--writer 0x…[,0x…]] [--contract 0x…]
 *
 * Pays with AGENT_PRIVATE_KEY, or — in demos — the static backend payer
 * (ARC_PAYMENT_SIGNER_PRIVATE_KEY). Testnet funds only; it spends real
 * (testnet) USDC through Circle Gateway, capped by --budget.
 */
import { writeFileSync } from 'node:fs';

import { formatMvReport, runMvAgent } from '@/agent/mv-agent';
import { parseUsdcToAtomic } from '@/lib/payments/usdc';
import { getServerEnv } from '@/server/config/env';
import { createDeviceEventChainReader } from '@/server/infrastructure/blockchain/device-event-chain-reader';
import { resolveArcRpcUrl } from '@/server/infrastructure/blockchain/network-provider';
import { resolveArcPaymentNetwork } from '@/server/infrastructure/payments/arc-payment-network';
import { createGatewayBuyer } from '@/server/infrastructure/payments/gateway-buyer';

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const env = getServerEnv();
const network = resolveArcPaymentNetwork(env);
if (network === null)
  fail(`ARC_CHAIN_ID ${env.ARC_CHAIN_ID} has no Circle Gateway support.`);
const key = process.env.AGENT_PRIVATE_KEY ?? env.ARC_PAYMENT_SIGNER_PRIVATE_KEY;
if (key === undefined || key.length === 0) {
  fail(
    'Set AGENT_PRIVATE_KEY (or ARC_PAYMENT_SIGNER_PRIVATE_KEY for the demo payer).',
  );
}
if (!network.isTestnet && process.env.AGENT_ALLOW_MAINNET !== 'true') {
  fail('Refusing to spend on Arc mainnet without AGENT_ALLOW_MAINNET=true.');
}

const writers = flag('--writer')
  ?.split(',')
  .map((w) => w.trim())
  .filter((w) => w.length > 0);

const report = await runMvAgent({
  baseUrl: flag('--base-url') ?? 'http://localhost:3000',
  budgetAtomic: parseUsdcToAtomic(flag('--budget') ?? '0.01'),
  maxPriceAtomic: parseUsdcToAtomic(flag('--max-price') ?? '0.001'),
  maxEvents: Number(flag('--max-events') ?? '10'),
  ...(flag('--token-id') !== undefined ? { tokenId: flag('--token-id') } : {}),
  ...(writers !== undefined ? { trustedWriters: writers } : {}),
  ...(flag('--contract') !== undefined
    ? { contractAddress: flag('--contract') }
    : {}),
  fetch,
  buyer: createGatewayBuyer({
    network,
    privateKey: key,
    rpcUrl: resolveArcRpcUrl(env),
  }),
  reader: createDeviceEventChainReader(),
  log: (line) => process.stderr.write(`${line}\n`),
});

process.stdout.write(`${formatMvReport(report)}\n`);
const out = flag('--out');
if (out !== undefined) {
  writeFileSync(
    out,
    JSON.stringify(
      report,
      (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
      2,
    ),
  );
  process.stderr.write(`Report written to ${out}\n`);
}
