import { toEventSelector } from 'viem';

import { DEVICE_EVENT_TYPES } from '@/server/application/telemetry/device-event-payloads';
import { verificationPolicyFromEnv } from '@/server/application/verification/verify-stored-event';
import { arcNetworkDisplayName, defaultArcRpcUrl } from '@/config/arc-network';
import { getServerEnv } from '@/server/config/env';

export const DEVICE_EVENT_SIGNATURE =
  'DeviceEvent(uint256 indexed tokenId, uint8 indexed eventType, bytes data, uint256 timestamp)';

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
      topic0: toEventSelector('DeviceEvent(uint256,uint8,bytes,uint256)'),
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
    checks: [
      {
        id: 'anchor_exists',
        rule: 'A DeviceEvent log from the contract exists in the stated transaction and block. Look it up by block (eth_getLogs fromBlock=toBlock=block), not only by tx hash: public Arc RPCs drop the hash index for older transactions.',
      },
      {
        id: 'finality',
        rule: 'latestBlock - block + 1 >= requiredConfirmations; otherwise pending.',
      },
      {
        id: 'authorized_writer',
        rule: "The anchoring transaction's sender (read from the block's transaction list) is one of trustedWriters. The contract admits any UPDATER_ROLE holder; only these writers are vouched for.",
      },
      {
        id: 'device_and_type',
        rule: "The log's tokenId and eventType are the record's.",
      },
      {
        id: 'content_hash',
        rule: 'keccak256(log.data) equals keccak256(utf8(payload you hold)).',
      },
      {
        id: 'stored_payload',
        rule: 'The payload you hold is byte-identical to log.data decoded as UTF-8.',
      },
      {
        id: 'record_commitment',
        rule: 'Payload v2 only: keccak256(utf8(salt + ":" + recordJson)) equals the payload\'s recordHash.',
      },
      {
        id: 'anchor_timeliness',
        rule: 'Block time is no earlier than the activity end (5 min skew) and no later than maxAnchorDelaySeconds after it (warning).',
      },
    ],
    verdicts: {
      verified: 'Every check passed.',
      verified_with_warnings:
        'No check failed, but at least one warned (e.g. anchored late).',
      unverified: 'At least one check failed.',
      pending: 'Not final or not anchored yet.',
    },
    limitations: [
      'Verification proves a record is anchored by an authorized writer, unchanged since, and timely. It does not prove the underlying measurement is true.',
      'Telemetry provider webhooks are authenticated with a secret shared only with this app, so provider origin is not third-party verifiable.',
      'The contract cannot stop other UPDATER_ROLE holders from writing events for a token; such events are reported as unverified.',
    ],
    endpoints: {
      byEvent: '/api/v1/verify/events/{deviceEventId}?refresh=1',
      byTransaction: '/api/v1/verify/tx/{transactionHash}?refresh=1',
      claim:
        'POST /api/v1/verify {"transactionHash","blockNumber","payloadJson"}',
    },
  };
}
