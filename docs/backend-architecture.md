# Backend architecture

This repository hosts the **dashboard**, **API**, and **Circle Gateway** payment
path as a modular monolith inside the Next.js App Router process, plus separate
**worker** and **demo agent** entrypoints.

## Dependency direction

```
Route Handler (src/app/api)
  → transport adapter (src/server/transport)
  → application use case (src/server/application)
  → domain ports (src/server/domain)
  → infrastructure adapters (src/server/infrastructure)
```

Route Handlers only extract/authenticate/validate, call one use case, and map
the result to HTTP. They must not query PostgreSQL, Enode, or Arc RPC directly.

## Processes

| Process | Entry                                   | Responsibility                                           |
| ------- | --------------------------------------- | -------------------------------------------------------- |
| Web/API | `next dev` / `next start`               | Public API, dashboard APIs, webhooks, health             |
| Worker  | `pnpm worker:dev` / `pnpm worker:start` | Outbox jobs (Enode webhook processing, retries)          |
| Agent   | `pnpm agent:dev` / `pnpm agent:start`   | Demo buyer: poll → 402 → pay → verify Arc + content hash |

Both web/worker share `src/server/**` and the same PostgreSQL schema. The agent
is a separate process and never runs in the browser.

## Phase status

**Circle Gateway vertical slice (current):**

- Agent `POST /api/v1/agent/telemetry/latest` (`NO_NEW_RECORD` / `402` / deliver)
- Circle Gateway facilitator settle → ledger credit + delivery + cursor
- Enode webhook ingest → normalize → immutable `telemetry_records` + content hash
- Dashboard read APIs + UI wiring (multi-wallet / multi-device)
- Demo agent Step-6: settlement receipt + content-hash verification

**Still deferred / not production-complete:**

- Production KMS DeviceNFT / buyer signing (raw private keys forbidden in prod/staging)
- Live Enode HTTP API client sync (`EnodeClient` remains fail-closed)
- DeviceNFT live provenance via `recordDeviceEvent` (mint path shares signer; needs UPDATER_ROLE)
- Cookie/session-scoped dashboard principal (RSC lists all bound wallets for now)
- Separate BE/FE repositories (monorepo process/module split documented in architecture.md)

`PROVENANCE_DELIVERY_MODE` is enforced (`strict` → `PROVENANCE_PENDING` until
`anchored`). Demo default is `pending`. Provenance uses
`createProvenanceAnchorForEnv()` (mock / live / fail-closed).

Agent telemetry uses DB rate limits. Enode webhooks honor optional IP allowlists.
Onboarding requires verified Web3Auth identity tokens.

## Key modules

- `src/server/config/env.ts` — server secrets/config (lazy `getServerEnv()`)
- `src/server/infrastructure/db/` — Drizzle schema, pool, repositories
- `src/server/infrastructure/auth/` — API-key hashing and authentication
- `src/server/infrastructure/payments/` — Circle Gateway seller/buyer + pricing
- `src/server/infrastructure/jobs/` — outbox worker handlers
- `src/server/application/telemetry/request-latest-telemetry.ts` — purchase use case
- `src/agent/index.ts` — demo autonomous agent
- `src/worker/index.ts` — worker process

See also: [database.md](./database.md), [api.md](./api.md),
[payment-flow.md](./payment-flow.md), [security.md](./security.md),
[runbooks.md](./runbooks.md).
