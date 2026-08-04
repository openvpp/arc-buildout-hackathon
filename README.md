# EV Telemetry Nanopayment Platform

Production-grade **Next.js App Router** monorepo containing:

1. The **dashboard** (viewer) for verified EV telemetry nanopayments
2. The **backend** (Route Handlers + worker + PostgreSQL + Circle Gateway x402)
3. A **demo autonomous agent** (`pnpm agent:dev`)

> **Status:** Circle Gateway vertical slice + Enode Link onboarding + Enode
> webhook ingest (HMAC-SHA1 / array envelope / optional IP allowlist) +
> BatchAnchor provenance jobs (mock / provisional live ABI) + Web3Auth JWT
> onboarding auth with `principal_wallets` binding + agent rate limits. Live
> Circle settle is fail-closed when mocks are off; CI uses facilitator doubles /
> mocks, not real funds. See
> [`docs/payment-flow.md`](./docs/payment-flow.md),
> [`docs/provenance.md`](./docs/provenance.md),
> [`docs/security.md`](./docs/security.md), and
> [`docs/demo-runbook.md`](./docs/demo-runbook.md).

## Overview

An autonomous agent buys the **latest** EV telemetry record from the backend
using a USDC nanopayment via **Circle Gateway** (`402 Payment Required`), the
backend settles and returns the record plus settlement tx id and content hash,
and the agent independently verifies the settlement tx and hash on **Arc
testnet**. This dashboard displays telemetry and the verification result,
**per wallet and per device**.

**The frontend is never the source of truth** for payments, telemetry freshness,
or verification. On-chain verification shown here is independent _evidence_, not
authorization. Full flow: [`docs/domain-overview.md`](./docs/domain-overview.md).

## Product flow — what’s done

| Step | Behavior                                             | Status                                                                                                           |
| ---- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Autonomous agent requests EV telemetry from the BE   | **Done** — `POST /api/v1/agent/telemetry/latest` + `pnpm agent:dev`                                              |
| 2    | BE responds `402 Payment Required` + payment details | **Done** — Circle Gateway x402 (`PAYMENT-REQUIRED` header)                                                       |
| 3    | Agent sends USDC nanopayment to the seller           | **Done (code)** — Gateway `payment-signature`; live funds need Circle/Arc keys (mocks allowed in demo/test only) |
| 4    | BE verifies payment and credits the balance          | **Done** — facilitator settle → ledger credit + delivery + cursor; tx-hash reuse rejected                        |
| 5    | BE returns telemetry + settlement tx id              | **Done** — `TELEMETRY_DELIVERED` with payload, `payment.transactionHash`, `contentHash`                          |
| 6    | Agent checks tx on Arc testnet + content hash match  | **Done (code)** — Viem receipt + hash check → `POST /api/v1/verification/results`                                |
| 7    | Dashboard shows the result                           | **Done** — wallets / devices / dashboard grouped by wallet → device                                              |

Additional product rules already implemented:

- **Latest record only** — agent polls on an interval; new record → `402`, else `NO_NEW_RECORD` / `NO_TELEMETRY_AVAILABLE`
- **Demo wallets & devices** — `pnpm db:seed` + `pnpm demo:inject-telemetry`
- **Multi-wallet / multi-device dashboard** — separate records per wallet and device
- **Enode vehicle onboarding** — Link → OAuth → finalize (`/devices/onboard`) with **Web3Auth** connect + **JWT** on onboarding APIs
- **Dashboard wallet binding** — verified Web3Auth identities upsert `dashboard_user` + `principal_wallets` (`owner`)
- **Enode webhooks** — HMAC-SHA1, array deliveries, nested `vehicle` mapping; optional `ENODE_WEBHOOK_ALLOWED_IPS`
- **BatchAnchor provenance** — worker `ANCHOR_TELEMETRY` / `CHECK_ANCHOR_CONFIRMATIONS`; `PROVENANCE_DELIVERY_MODE`
- **Agent rate limits** — DB-backed limiter on `POST /api/v1/agent/telemetry/latest` (default 60 / 60s)

Still deferred:

- Cookie/session-scoped dashboard principal (RSC lists bound wallets today)
- Production KMS for BatchAnchor / buyer signing (raw private keys forbidden in prod/staging)
- Real BatchAnchor contract ABI (provisional `anchorContentHash` ships for demos)

## Mock vs live Circle

| Mode     | When                                                            | Evidence                                                                                |
| -------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Mock** | `ALLOW_MOCK_ADAPTERS=true` (dev/demo/test only)                 | Deterministic settle; **not** live payment proof                                        |
| **Live** | `ALLOW_MOCK_ADAPTERS=false` + real facilitator + funded wallets | Arc settlement `transactionHash`; seller wallet **required** (demo `0x1111…` forbidden) |

Never treat mock settlement as live payment evidence. Stakeholder click-through:
[`docs/demo-runbook.md`](./docs/demo-runbook.md) (path A mock, path B live checklist).

## Local setup

```bash
corepack enable
pnpm install
pnpm services:up          # Postgres on :5432, test DB on :5433
cp .env.example .env.local
# set DATABASE_URL + API_KEY_HASH_SECRET (≥32 chars)
# mock path: ALLOW_MOCK_ADAPTERS=true
# live path: ALLOW_MOCK_ADAPTERS=false + SELLER_WALLET_ADDRESS + Circle/Arc keys
# Web3Auth: NEXT_PUBLIC_WEB3AUTH_CLIENT_ID (Sapphire Devnet) in .env.local
pnpm db:migrate
pnpm db:seed
pnpm demo:inject-telemetry
pnpm dev                  # http://localhost:3000
pnpm worker:dev           # Enode webhook processing
# copy AGENT_* from seed → pnpm agent:dev
```

## Available commands

```bash
pnpm dev / build / start
pnpm worker:dev / worker:start
pnpm agent:dev / agent:start
pnpm services:up / down / logs
pnpm db:generate / migrate / check / seed / studio
pnpm demo:inject-telemetry  # one demo-marked telemetry row for agent poll
pnpm lint / format / typecheck
pnpm test / test:unit / test:integration / test:backend / test:e2e
pnpm openapi:generate / openapi:check
pnpm validate             # format + lint + typecheck + unit + build
pnpm validate:backend     # db:check + lint + typecheck + backend tests + openapi + build
```

## Technology stack

| Area        | Choice                                               |
| ----------- | ---------------------------------------------------- |
| Framework   | Next.js 16 (App Router), React 19                    |
| Backend     | Route Handlers (nodejs) + `src/worker` outbox worker |
| Database    | PostgreSQL 16 + Drizzle ORM 0.45 + Drizzle Kit 0.31  |
| Payments    | Circle Gateway x402 (`@circle-fin/x402-batching`)    |
| Validation  | Zod 4                                                |
| Logging     | Pino 10 (server), typed logger (frontend)            |
| Testing     | Vitest 4 (unit + PG integration), Playwright         |
| Package mgr | pnpm 11, Node.js 24 LTS                              |

Exact pinned versions are in [`package.json`](./package.json).

## Documentation

- [`docs/frontend.md`](./docs/frontend.md)
- [`docs/backend-architecture.md`](./docs/backend-architecture.md)
- [`docs/database.md`](./docs/database.md)
- [`docs/api.md`](./docs/api.md)
- [`docs/payment-flow.md`](./docs/payment-flow.md)
- [`docs/demo-runbook.md`](./docs/demo-runbook.md)
- [`docs/provenance.md`](./docs/provenance.md)
- [`docs/enode-integration.md`](./docs/enode-integration.md)
- [`docs/security.md`](./docs/security.md)
- [`docs/runbooks.md`](./docs/runbooks.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/development.md`](./docs/development.md)
- [`docs/domain-overview.md`](./docs/domain-overview.md)

## Production readiness

**Not production-ready yet.** Demo / hackathon vertical slice with fail-closed
guards — not a production deployment checklist.

| Area                          | Ready? | Notes                                                                             |
| ----------------------------- | ------ | --------------------------------------------------------------------------------- |
| Circle 402 → settle → deliver | Code   | Live needs facilitator + Arc RPC + funded wallets; seller required when mocks off |
| Settlement tx-hash reuse      | Done   | Cross-requirement reuse → `PAYMENT_TRANSACTION_REUSED`                            |
| Enode webhook ingest          | Code   | HMAC-SHA1 + array/`vehicle` mapping; optional IP allowlist; needs secret + worker |
| Enode vehicle Link onboarding | Code   | Sandbox credentials + redirect URI + Web3Auth Bearer JWT                          |
| Web3Auth JWT + wallet binding | Demo   | JWKS verify + `principal_wallets`; mock `Bearer mock:0x…` only when mocks on      |
| BatchAnchor provenance        | Demo   | Mock/live adapters + worker; `pending` sells early, `strict` waits for `ANCHORED` |
| Rate limiting on agent APIs   | Done   | `AGENT_RATE_LIMIT_*` (default 60/60s per principal); `Retry-After` from window    |
| Buyer signing in prod         | No     | Env private key forbidden in prod; KMS/reference still deferred                   |

`pnpm validate` covers format/lint/typecheck/unit/build. Integration tests need
Postgres (`pnpm services:up && pnpm test:integration`).

## Security

Never commit secrets, private keys, seed phrases, webhook secrets, or production
`.env` files. Public defaults live in `.env`; server secrets are documented in
`.env.example` and must stay out of `NEXT_PUBLIC_*`. Production/staging reject
mock adapters and raw buyer private keys in env. Live mode rejects the demo
seller wallet `0x1111…`.
