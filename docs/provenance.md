# Provenance

**Status:** mock + provisional live BatchAnchor adapters wired. Worker jobs
`ANCHOR_TELEMETRY` / `CHECK_ANCHOR_CONFIRMATIONS` update
`telemetry_records.anchor_status`. Delivery policy is enforced via
`PROVENANCE_DELIVERY_MODE`.

## Concepts

- Canonical telemetry JSON (deterministic key order, UTC timestamps)
- `contentHash` via configured algorithm (default SHA-256)
- On-chain commitment of the hash/batch root only — never raw telemetry
- `anchorTransactionHash` / block metadata stored separately from payments
- Never treat payment settlement tx as an anchor tx

## Delivery policy

`PROVENANCE_DELIVERY_MODE`:

| Mode      | Behavior                                                                             |
| --------- | ------------------------------------------------------------------------------------ |
| `pending` | May sell/release with `provenance.status = PENDING` (demo default in `.env.example`) |
| `strict`  | New sales blocked with `PROVENANCE_PENDING` (409) until `anchorStatus === anchored`  |

Already-delivered purchases can still be replayed even in `strict` mode.

Never return API `ANCHORED` unless the worker marked the row `anchored` from
adapter/receipt evidence. Mock adapters may invent confirmation only when
`ALLOW_MOCK_ADAPTERS=true`.

## Worker flow

1. Enode webhook / `pnpm demo:inject-telemetry` inserts a record and enqueues
   `ANCHOR_TELEMETRY`
2. Worker submits via `ProvenanceAnchor.anchorTelemetry` → status `submitted`
3. Enqueues `CHECK_ANCHOR_CONFIRMATIONS`
4. Mock path: verify adapter + set `anchored` immediately
5. Live path: wait for receipt + `ARC_REQUIRED_CONFIRMATIONS`, then verify

Run `pnpm worker:dev` alongside `pnpm dev` for anchors to progress.

## Live vs mock

| Mode            | Requirements                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------- |
| Mock            | `ALLOW_MOCK_ADAPTERS=true`                                                                    |
| Live (dev/demo) | `BATCH_ANCHOR_CONTRACT_ADDRESS` + `ARC_RPC_URL` + `BATCH_ANCHOR_SIGNER_PRIVATE_KEY`           |
| Production      | Raw signer key forbidden — use `BATCH_ANCHOR_SIGNER_KEY_REFERENCE` (KMS; not implemented yet) |

## Batching

Tables `anchor_batches` and `anchor_batch_records` support batch roots so the
API does not claim per-record transactions when a batch was used. The current
provisional ABI commits **one content hash per call**
(`anchorContentHash(bytes32)`).

## ABI

Provisional artifact:
`src/server/infrastructure/blockchain/batch-anchor-abi.ts`
(`BATCH_ANCHOR_ABI_VERSION = provisional-anchorContentHash-v1`).

Replace with the contract project's versioned ABI when available. Do not treat
the provisional ABI as production OpenVPP BatchAnchor.

Agent Step-6 verifies the **settlement** `paymentTransactionHash` and that the
returned content hash matches — independent of BatchAnchor until product policy
requires otherwise.
