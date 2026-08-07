# Provenance

**Status:** mock + live DeviceNFT `recordDeviceEvent` (preferred) and
provisional BatchAnchor fallback. Worker jobs `ANCHOR_TELEMETRY` /
`CHECK_ANCHOR_CONFIRMATIONS` update `telemetry_records.anchor_status`. Delivery
policy is enforced via `PROVENANCE_DELIVERY_MODE`.

## Concepts

- Canonical telemetry JSON (deterministic key order, UTC timestamps)
- `contentHash` via configured algorithm (default SHA-256)
- On-chain commitment of the hash only — never raw telemetry
- Preferred live path: DeviceNFT `recordDeviceEvent(tokenId, eventType, data)`
  with `data` = content hash bytes32 (requires a minted `nft_token_id`)
- Fallback: BatchAnchor `anchorContentHash(bytes32)` when DeviceNFT is not
  configured
- `anchorTransactionHash` / block metadata stored separately from payments
  (DB field name kept for compatibility; UI says “Device event”)
- Never treat payment settlement tx as a device-event / BatchAnchor tx

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
2. Worker loads the device’s `nftTokenId`. If missing, the job **retries**
   (does not mark `failed`) until mint completes
3. Worker submits via `ProvenanceAnchor.anchorTelemetry` → status `submitted`
4. Enqueues `CHECK_ANCHOR_CONFIRMATIONS`
5. Mock path: verify adapter + set `anchored` immediately
6. Live path: wait for receipt + `ARC_REQUIRED_CONFIRMATIONS`, then verify

Run `pnpm worker:dev` alongside `pnpm dev` for device events to progress.

## Live vs mock

| Mode                        | Requirements                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock                        | `ALLOW_MOCK_ADAPTERS=true`                                                                                                                                      |
| Live DeviceNFT (preferred)  | `DEVICE_NFT_CONTRACT_ADDRESS` + `USE_ARC_NETWORK` + `ARC_RPC_URL` + `ARC_AUTH_TOKEN` + `DEVICE_NFT_MINTER_PRIVATE_KEY` / `PRIVATE_KEY` (needs **UPDATER_ROLE**) |
| Live BatchAnchor (fallback) | `BATCH_ANCHOR_CONTRACT_ADDRESS` + `ARC_RPC_URL` + `BATCH_ANCHOR_SIGNER_PRIVATE_KEY`                                                                             |
| Production                  | Raw signer keys forbidden — KMS via key references (not implemented yet)                                                                                        |

## Batching

Tables `anchor_batches` and `anchor_batch_records` support batch roots so the
API does not claim per-record transactions when a batch was used. DeviceNFT
path commits **one content hash per `recordDeviceEvent` call**. BatchAnchor
fallback still uses `anchorContentHash(bytes32)`.

## ABI

- DeviceNFT: `src/server/infrastructure/blockchain/device-nft-abi.ts`
  (`recordDeviceEvent`, `DEVICE_EVENT_TYPE_TELEMETRY_HASH = 1`)
- BatchAnchor (fallback): `src/server/infrastructure/blockchain/batch-anchor-abi.ts`

Agent Step-6 verifies the **settlement** `paymentTransactionHash` and that the
returned content hash matches — independent of device-event / BatchAnchor until
product policy requires otherwise.
