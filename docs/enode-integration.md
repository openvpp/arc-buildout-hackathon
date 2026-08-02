# Enode integration

**Status:** webhook ingest path implemented; live Enode HTTP API client deferred.

## Implemented webhook flow

`POST /api/webhooks/enode`

1. Capture raw body bytes
2. Verify authenticity (configured controls; mocks only when `ALLOW_MOCK_ADAPTERS`)
3. Persist `webhook_deliveries` with payload hash / dedupe key
4. Enqueue `PROCESS_ENODE_WEBHOOK` outbox event
5. Return quickly; normalize asynchronously in the worker
6. Worker inserts immutable `telemetry_records` with canonical JSON + SHA-256 hash

Never log full webhook bodies by default. Unknown event types must not crash
ingestion. Do not claim `ANCHORED` from webhook processing.

## Deferred: Enode API client

`EnodeClient` port: `src/server/domain/shared/ports.ts`  
Fail-closed stub: `createFailClosedEnodeClient` in
`src/server/infrastructure/blockchain/adapters.ts`.

Polling/sync against Enode’s HTTP APIs is **not** implemented. Production must
not pretend stubbed client calls succeeded.

## Configuration

See `.env.example` for `ENODE_*` variables. Secrets must never be
`NEXT_PUBLIC_*`.
