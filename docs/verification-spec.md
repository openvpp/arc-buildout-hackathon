# Device record verification spec (v1)

How anyone — a utility, an auditor, or an autonomous agent — can confirm a
device record is anchored on Arc and unchanged, **without trusting this
app**. The same rules are served as JSON at `GET /api/v1/verify/spec`, and
`scripts/verify-standalone.ts` implements them using only `viem` and a public
RPC.

## What a record is

Each published record is one `recordDeviceEvent(tokenId, eventType, data)`
call on the already-deployed DeviceNFT contract, which emits:

```
DeviceEvent(uint256 indexed tokenId, uint8 indexed eventType, bytes data, uint256 timestamp)
topic0 = 0x3de799dd7abe8fd56ddf6376287c6702888d24fbc26726a7d9bbfab1c3c53962
```

- `eventType` 2 = `CHARGING_COMPLETED` (one per completed charging session),
  12 = `TRIP_COMPLETED` (one per device per UTC day of driving).
- `data` is the UTF-8 JSON payload (the public half of the record).
- **Payload v1** has public fields only.
- **Payload v2** adds a final `recordHash` field:
  `keccak256(utf8(salt + ":" + recordJson))`, a commitment to the full
  off-chain record (including location and raw odometer readings) that is
  never published. `salt` is 32 random bytes per record, so the private
  values can't be brute-forced from the hash.

## The checks

| Check               | Rule                                                                             | Fails when                                         |
| ------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| `anchor_exists`     | A `DeviceEvent` from the contract is in the stated transaction **and block**.    | Not found.                                         |
| `finality`          | `latestBlock − block + 1 ≥ requiredConfirmations`.                               | Not final yet → **pending**, not failed.           |
| `authorized_writer` | The transaction's sender is one of the published `trustedWriters`.               | Any other sender.                                  |
| `device_and_type`   | The log's `tokenId` and `eventType` are the record's.                            | Mismatch.                                          |
| `content_hash`      | `keccak256(log.data) = keccak256(utf8(payload you hold))`.                       | Any byte differs.                                  |
| `stored_payload`    | The payload you hold equals `log.data` as UTF-8.                                 | Any byte differs.                                  |
| `record_commitment` | v2 only: `keccak256(utf8(salt + ":" + recordJson)) = recordHash`.                | Private record changed or deleted. Skipped for v1. |
| `anchor_timeliness` | Block time ≥ activity end − 5 min, and ≤ activity end + `maxAnchorDelaySeconds`. | Earlier → fail (backdated). Later → **warning**.   |

**Verdict:** any fail → `unverified`; else any pending → `pending`; else any
warning → `verified_with_warnings`; else `verified`.

For the daily series, the admin view also reports **completeness**: a UTC day
with raw odometer readings must be published, or explained (finalized under
0.1 mi). Silent days are not gaps — their distance carries into the next day.

## How to read the chain (important)

Look the anchor up **by block**:
`eth_getLogs({address, topics:[topic0], fromBlock: block, toBlock: block})`,
and read the sender from `eth_getBlockByNumber(block, true)`. Arc's public
RPCs drop the transaction-hash index for older transactions while still
serving their blocks and logs, so `eth_getTransactionByHash` /
`eth_getTransactionReceipt` can return "not found" for a real, old record.
They also load-balance across nodes with different history retention, so
retry `requested data not available` a few times. `eth_getLogs` ranges above
~2,000 blocks are rejected.

Public RPCs: `https://rpc.testnet.arc.io` (chain 5042002),
`https://rpc.mainnet.arc.io` (chain 5042).

## Ways to verify

1. **Standalone, no trust in this app:**
   `pnpm verify:standalone -- --rpc <rpc> --contract <address> --tx <hash> --block <n> --payload '<json>' --writer <trusted writer>`
   (add `--record-file <file> --salt <hex>` to check a v2 private record).
2. **Public API** (unauthenticated, rate-limited):
   - `GET /api/v1/verify/tx/{hash}` or `/api/v1/verify/events/{id}` (add
     `?refresh=1` to re-read the chain when the cached result is > 5 min old);
   - `POST /api/v1/verify` with `{"transactionHash","blockNumber","payloadJson"}`
     — works for any `DeviceEvent` on the contract, stores nothing.
3. **Web:** `/verify` and `/verify/{hash}`.

## What verification does not prove

- It proves a record is anchored by an authorized writer, unchanged since,
  and timely. It does **not** prove the vehicle's measurement was correct.
- Telemetry provider (Enode) webhooks are authenticated with a secret shared
  only with this app, so the provider origin is not third-party verifiable.
- The contract cannot stop other `UPDATER_ROLE` holders from writing events
  for a token. Those are reported `unverified` (authorized-writer check).
- v1 records (before `recordHash`) are verifiable at payload level only.
