import {
  CHECK_IDS,
  type Verdict,
  type VerificationCheckId,
} from '@/lib/verification/vocabulary';
import { DEVICE_EVENT_TYPES } from '@/server/application/telemetry/device-event-payloads';
import { verificationPolicyFromEnv } from '@/server/application/verification/verify-stored-event';
import { arcNetworkDisplayName, defaultArcRpcUrl } from '@/config/arc-network';
import { getServerEnv } from '@/server/config/env';
import {
  DEVICE_EVENT_SIGNATURE,
  DEVICE_EVENT_TOPIC0,
} from '@/server/infrastructure/blockchain/device-nft-abi';

const CHECK_RULES: Record<VerificationCheckId, string> = {
  anchor_exists:
    'A DeviceEvent log from the contract exists in the stated transaction and block. Look it up by block (eth_getLogs fromBlock=toBlock=block), not only by tx hash: public Arc RPCs drop the hash index for older transactions.',
  finality:
    'latestBlock - block + 1 >= requiredConfirmations; otherwise pending.',
  authorized_writer:
    "The anchoring transaction's sender (read from the block's transaction list) is one of trustedWriters. The contract admits any UPDATER_ROLE holder; only these writers are vouched for.",
  device_and_type:
    "The log's tokenId and eventType equal the ones you expect (the record's). When a transaction holds several DeviceEvents, check the log whose keccak256(data) equals your payload's hash. Skipped when no device is expected.",
  content_hash: 'keccak256(log.data) equals keccak256(utf8(payload you hold)).',
  stored_payload:
    'The payload you hold is byte-identical to log.data decoded as UTF-8.',
  record_commitment:
    'Payload v2 only: keccak256(utf8(salt + ":" + recordJson)) equals the recordHash inside the anchored bytes (never a database copy).',
  anchor_timeliness:
    "Activity end = the anchored payload's endTime. Block time is no earlier than the activity end (5 min skew; earlier fails) and no later than maxAnchorDelaySeconds after max(activity end, the DeviceNFT's mint) (later warns).",
};

const VERDICT_MEANINGS: Record<Verdict, string> = {
  verified: 'Every check passed.',
  verified_with_warnings:
    'No check failed, but at least one warned (e.g. anchored late).',
  unverified: 'At least one check failed.',
  pending: 'Not final or not anchored yet.',
};

export type VerificationSpec = ReturnType<typeof buildVerificationSpec>;

let cachedSpec: VerificationSpec | null = null;

/** The spec only depends on configuration, so build it once per process. */
export function getVerificationSpec(): VerificationSpec {
  cachedSpec ??= buildVerificationSpec();
  return cachedSpec;
}

/**
 * Machine-readable verification spec: everything a third party (or agent)
 * needs to verify a record without trusting this server. Mirrors
 * docs/verification-spec.md.
 */
export function buildVerificationSpec() {
  const env = getServerEnv();
  const policy = verificationPolicyFromEnv();
  return {
    specVersion: 1,
    network: {
      name: arcNetworkDisplayName(env.ARC_CHAIN_ID),
      chainId: env.ARC_CHAIN_ID,
      publicRpcUrl: defaultArcRpcUrl(env.ARC_CHAIN_ID),
    },
    contract: {
      address: env.DEVICE_NFT_CONTRACT_ADDRESS ?? null,
      event: DEVICE_EVENT_SIGNATURE,
      topic0: DEVICE_EVENT_TOPIC0,
      eventTypes: {
        CHARGING_COMPLETED: DEVICE_EVENT_TYPES.CHARGING_COMPLETED,
        TRIP_COMPLETED: DEVICE_EVENT_TYPES.TRIP_COMPLETED,
      },
    },
    trustedWriters: policy.trustedWriters,
    requiredConfirmations: policy.requiredConfirmations.toString(),
    maxAnchorDelaySeconds: policy.maxAnchorDelaySeconds,
    payloadVersions: {
      '1': 'Public fields only. Verifiable at payload level.',
      '2': 'Public fields plus a final `recordHash` = keccak256(utf8(salt + ":" + recordJson)) committing to the full off-chain record. Verifiable at record level by whoever holds recordJson and salt.',
    },
    checks: CHECK_IDS.map((id) => ({ id, rule: CHECK_RULES[id] })),
    verdicts: VERDICT_MEANINGS,
    limitations: [
      'Verification proves a record is anchored by an authorized writer, unchanged since, and timely. It does not prove the underlying measurement is true.',
      'Telemetry provider webhooks are authenticated with a secret shared only with this app, so provider origin is not third-party verifiable.',
      'The contract cannot stop other UPDATER_ROLE holders from writing events for a token; such events are reported as unverified.',
    ],
    endpoints: {
      byEvent:
        '/api/v1/verify/events/{deviceEventId} (stored result; ?refresh=1 re-reads the chain now)',
      byTransaction:
        '/api/v1/verify/tx/{transactionHash} (stored result; ?refresh=1 re-reads the chain now)',
      claim:
        'POST /api/v1/verify {"transactionHash","blockNumber","payloadJson","tokenId"?,"eventType"?}',
      standalone:
        'pnpm verify:standalone -- --rpc <rpc> --contract <address> --tx <hash> --block <n> --payload <json> --writer <trustedWriters> [--token-id <n> --event-type <n>]',
    },
  };
}
