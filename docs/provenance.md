# Provenance

**Status:** schema + ports ready; BatchAnchor adapter **deferred**. Delivered
telemetry currently reports provenance `PENDING`.

## Concepts

- Canonical telemetry JSON (deterministic key order, UTC timestamps)
- `contentHash` via configured algorithm (default SHA-256)
- On-chain commitment of the hash/batch root only — never raw telemetry
- `anchorTransactionHash` / block metadata stored separately from payments

## Delivery policy (intended vs actual)

`PROVENANCE_DELIVERY_MODE` env:

- `strict` (default in env schema) — **intended:** do not release until anchor
  confirmations meet threshold
- `pending` — **intended:** may release with `provenance.status = PENDING`

**Actual today:** Circle settle + ledger/delivery releases telemetry with
provenance `PENDING`. Strict mode is **not enforced** in the purchase use case
yet. Never return `ANCHORED` unless independently verified on-chain via a real
BatchAnchor adapter.

Agent Step-6 verifies the **settlement** `paymentTransactionHash` and that the
returned content hash matches — not BatchAnchor.

## Batching

Tables `anchor_batches` and `anchor_batch_records` support batch roots so the
API does not claim per-record transactions when a batch was used.

## ABI

Load the real BatchAnchor ABI from a version-controlled artifact supplied by the
contract project. Do not invent ABIs.
