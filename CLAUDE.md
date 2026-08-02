# CLAUDE.md

Engineering contract for Claude Code and other AI coding agents working in this
repository. Read this file fully before modifying anything.

## Project purpose

This repository is a **monorepo** hosting the **frontend dashboard**, **backend
API/worker**, and **demo agent** for a **verified EV telemetry nanopayment
marketplace** (Circle Gateway x402 on Arc testnet).

Intended flow (vertical slice implemented):

- An **autonomous AI agent** requests the latest EV telemetry record from the
  backend.
- When a new record exists, the backend replies **`402 Payment Required`** with
  **Circle Gateway** nanopayment instructions. When there is no new record it
  returns **`NO_NEW_RECORD`** (or **`NO_TELEMETRY_AVAILABLE`**).
- The agent signs a Gateway payment payload and retries with `payment-signature`.
  The backend **settles via the Circle facilitator**, credits the ledger, then
  returns the telemetry record, the **settlement** `paymentTransactionHash`, and
  the telemetry **content hash** (provenance stays `PENDING` until BatchAnchor).
- The agent **independently verifies** on **Arc testnet** that the settlement
  tx exists/succeeds and that the recomputed content hash matches.
- This **dashboard** displays the telemetry record and the verification result,
  per **wallet** and per **device** (multi-wallet, multi-device).

The backend owns Enode webhook ingestion, PostgreSQL, Circle Gateway settle,
ledger/delivery, and content hashing. Full BatchAnchor provenance and live Enode
API client sync remain deferred behind ports.

### The frontend is never the source of truth

The dashboard is a **viewer**. It is **never** the source of truth for:

- payments,
- telemetry freshness,
- blockchain verification / authorization.

On-chain verification shown here is **independent evidence**, not authorization
to release telemetry. Definitive authorization lives in the backend.

## Current implementation phase

- **Circle Gateway vertical slice:** agent latest-telemetry 402 → settle →
  ledger/delivery, Enode webhook → hash/persist, demo agent Step-6 verification,
  dashboard read APIs + UI wiring.
- **Still deferred:** BatchAnchor on-chain provenance (`ANCHORED`), production
  KMS buyer signing, live Circle funds in CI (use facilitator doubles /
  `ALLOW_MOCK_ADAPTERS` in test/demo only).

## Commands

```bash
pnpm dev                 # Next.js web/API
pnpm worker:dev          # background outbox worker
pnpm services:up         # Docker Compose Postgres
pnpm db:migrate          # apply SQL migrations (explicit step)
pnpm db:seed             # demo seed (marked as demo)
pnpm build / start
pnpm lint / lint:fix
pnpm format / format:check
pnpm typecheck
pnpm test                # unit + frontend tests
pnpm test:unit
pnpm test:integration    # requires Postgres
pnpm test:backend
pnpm test:e2e
pnpm openapi:check
pnpm validate            # frontend-oriented gate
pnpm agent:dev / agent:start
pnpm validate:backend    # backend gate (needs Postgres for integration)
```

## Architectural boundaries

Frontend dependency direction:

```
app/routes → features → shared (components, hooks, lib) → config/utilities
```

Backend dependency direction:

```
Route Handler → transport → application → domain ports → infrastructure
```

- Pages and layouts stay **thin**; business logic lives in `features` / `lib` /
  `server/application`.
- Components **do not** call external APIs directly (no `fetch` in components).
- Route Handlers **do not** contain business logic or call Drizzle/Enode/Arc
  directly.
- Untrusted external data is **validated with Zod** at the boundary.
- Features may consume shared modules; **shared modules must not import
  features**.
- Domain/application layers **must not import Next.js or React**.
- Public env: `src/config/env.ts` only. Server env: `src/server/config/env.ts`
  only.
- Server-only values must **never** be exposed via `NEXT_PUBLIC_*`.
- Blockchain/wallet secrets must **never** be in the frontend bundle.

## Backend rules (mandatory)

### Architecture

- Route Handlers are transport adapters only.
- Route Handlers never query PostgreSQL directly.
- Domain and application layers cannot import Next.js.
- Repository interfaces belong outside infrastructure.
- Infrastructure implements domain-facing interfaces.
- External provider payloads never become domain objects without validation and
  mapping.
- Background jobs must be idempotent.
- Financial state must be ledger-backed.
- Payment and provenance transactions are distinct
  (`paymentTransactionHash` vs `anchorTransactionHash`).

### Database

- Every schema change requires a committed migration.
- Never use schema push in production.
- Do not edit an applied migration.
- Add constraints, not only application checks.
- Avoid unbounded queries; every new list endpoint requires pagination.
- Every production query must be reviewed for indexes.
- Do not use floating point for token values.
- Do not mutate anchored telemetry records.

### Payments

- Never trust a client-provided amount, recipient, chain, or token contract.
- Never credit from transaction hash format validation alone.
- Settle via Circle Gateway facilitator (`CircleGatewaySeller.settle`); do not
  treat mock settlement as live payment evidence.
- Prevent settlement transaction reuse (`chain_id + transaction_hash`).
- Credit exactly once (ledger + delivery + cursor in one DB transaction).
- Never return paid telemetry before settle + ledger/delivery commit.
- Production must fail closed when the facilitator is unavailable.
- Never conflate `paymentTransactionHash` (settlement) with
  `anchorTransactionHash` (BatchAnchor — deferred).

### Webhooks

- Verify authenticity before processing.
- Preserve the raw body.
- Store deliveries before asynchronous normalization.
- Deduplicate deliveries.
- Return quickly.
- Unknown event types must not crash ingestion.
- Never log complete webhook bodies by default.

### Security

- No secrets in source control.
- No private keys in frontend code.
- No mock verification in production.
- No broad CORS.
- No sensitive values in logs.
- No raw internal errors in API responses.
- Validate authorization in the application layer.
- Use idempotency for financial writes.

### Testing

- Use PostgreSQL for database integration tests.
- Add concurrency tests for exactly-once behavior.
- Do not claim blockchain verification without testing the event logs.
- Test all failure branches.
- Never use real funds in automated tests.

### Backend completion workflow

1. Read the relevant domain and infrastructure modules.
2. Inspect the current database schema.
3. Generate a migration when needed.
4. Add or update tests.
5. Run targeted tests.
6. Run `pnpm validate:backend`.
7. Report the exact commands executed.
8. Report every failed or skipped check.
9. Never claim success without actual execution.

## Coding rules

- Strict TypeScript. **No `any`.** Use `unknown` at untrusted boundaries and
  narrow with schemas / predicates / discriminated unions.
- **No** `@ts-ignore` / `@ts-expect-error` / suppressed type errors without a
  written explanation.
- **No** disabled ESLint rules without a narrow, inline, explained
  `// eslint-disable-next-line <rule> -- reason` comment.
- **No** `console.log` in application code — use `src/lib/logger` (frontend) or
  `src/server/infrastructure/logging` (backend). No silent error swallowing.
- **No** default exports except where a framework convention requires them.
- Schema-validate all external data. Render explicit loading/empty/success/error
  states in the UI.
- Keep **Client Component** boundaries minimal.

## React and Next.js rules

- **Server Components by default**; `'use client'` only when needed.
- **No unnecessary `useEffect`.**
- Backend routes that touch Postgres/crypto/RPC must use:

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

- Do not run database or blockchain code on the Edge runtime.
- Long-running work belongs in `src/worker`, not inside HTTP request lifecycles.

## Testing expectations

- Unit tests for pure logic; component tests for behavior; PostgreSQL
  integration tests for repositories/transactions; Playwright for critical UI
  journeys.
- Mock network boundaries with controlled test doubles. Tests must **never**
  touch real wallets, Enode, Arc, or production services.

## Agent workflow

1. Read this `CLAUDE.md`.
2. Inspect the relevant existing files.
3. Identify the architectural boundaries involved.
4. Make the **smallest coherent change**.
5. Add or update tests.
6. Run targeted checks.
7. Run **`pnpm validate`** and/or **`pnpm validate:backend`** as appropriate.
8. Report the changed files and the validation results.
9. **Never claim a check passed unless it was actually executed.**
10. Explicitly disclose any checks that could not be run.

## Prohibited actions

- Committing secrets, or adding private wallet keys / seed phrases.
- Fabricating blockchain verification or telemetry; treating mock data as real.
- Silently falling back to mocks in production.
- Disabling lint or type checking globally.
- Installing dependencies without explaining their purpose.
- Editing generated files manually (e.g. `next-env.d.ts`, lockfile) except via
  the project's generate scripts.
- Broad refactors unrelated to the current task.
- Returning telemetry **before** backend payment verification.
- Conflating payment and provenance transaction hashes.

## Key files

- `src/config/env.ts` — public env only.
- `src/server/config/env.ts` — server secrets/config.
- `src/server/infrastructure/db/` — Drizzle schema, pool, repositories.
- `src/server/domain/shared/ports.ts` — deferred integration interfaces.
- `src/worker/index.ts` — background worker.
- `src/lib/api/` — frontend typed API client.
- `src/features/*/index.ts` — feature public surfaces.
- `docs/` — architecture, API, database, payments, provenance, runbooks.
