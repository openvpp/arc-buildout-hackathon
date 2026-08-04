# EV Telemetry Nanopayment Platform

Production-grade **Next.js App Router** monorepo containing:

1. The **dashboard** (viewer) for verified EV telemetry nanopayments
2. The **backend** (Route Handlers + worker + PostgreSQL + Circle Gateway x402)
3. A **demo autonomous agent** (`pnpm agent:dev`)

> **Status: Circle Gateway vertical slice implemented.** Agent latest-telemetry
> `402` → settle → ledger/delivery, Enode webhook → hash/persist, Step-6 Arc +
> content-hash verification, and multi-wallet/device dashboard wiring are in
> place. Full BatchAnchor on-chain provenance and a separate BE/FE repository
> split remain deferred. See [`CLAUDE.md`](./CLAUDE.md) and
> [`docs/payment-flow.md`](./docs/payment-flow.md).

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
| 4    | BE verifies payment and credits the balance          | **Done** — facilitator settle → ledger credit + delivery + cursor                                                |
| 5    | BE returns telemetry + settlement tx id              | **Done** — `TELEMETRY_DELIVERED` with payload, `payment.transactionHash`, `contentHash`                          |
| 6    | Agent checks tx on Arc testnet + content hash match  | **Done (code)** — Viem receipt + hash check → `POST /api/v1/verification/results`                                |
| 7    | Dashboard shows the result                           | **Done** — wallets / devices / dashboard grouped by wallet → device                                              |

Additional product rules already implemented:

- **Latest record only** — agent polls on an interval; new record → `402`, else `NO_NEW_RECORD` / `NO_TELEMETRY_AVAILABLE`
- **Demo wallets & devices** — `pnpm db:seed`
- **Multi-wallet / multi-device dashboard** — separate records per wallet and device
- **Enode vehicle onboarding** — Link → OAuth → finalize → `devices` + `enode_connections` (`/devices/onboard`, see [`docs/enode-integration.md`](./docs/enode-integration.md))

Still deferred / different from a future split-repo production setup:

- Separate BE and FE repositories (this repo is a **monorepo**)
- Web3Auth (onboarding currently uses a temporary wallet address stub)
- Live production Enode sync beyond Link (webhook path exists; needs real Enode credentials + running worker/DB)
- BatchAnchor claiming `ANCHORED` on-chain (provenance stays `PENDING` for now)
- End-to-end with real Circle funds (path exists; CI uses facilitator doubles / `ALLOW_MOCK_ADAPTERS`)

## Local setup

```bash
corepack enable
pnpm install
pnpm services:up          # Postgres on :5432, test DB on :5433
cp .env.example .env.local
# set DATABASE_URL + API_KEY_HASH_SECRET (≥32 chars)
pnpm db:migrate
pnpm db:seed              # optional demo principal/API key
# optional Enode Link: set ENODE_CLIENT_* + ENODE_REDIRECT_URI, then /devices/onboard
pnpm dev                  # http://localhost:3000
pnpm worker:dev           # separate terminal (Enode webhook processing)
# optional: configure AGENT_* + ARC_PAYMENT_SIGNER_PRIVATE_KEY (dev/demo only)
pnpm agent:dev
```

## Available commands

```bash
pnpm dev / build / start
pnpm worker:dev / worker:start
pnpm agent:dev / agent:start
pnpm services:up / down / logs
pnpm db:generate / migrate / check / seed / studio
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
| Validation  | Zod 4                                                |
| Logging     | Pino 10 (server), typed logger (frontend)            |
| Testing     | Vitest 4 (unit + PG integration), Playwright         |
| Package mgr | pnpm 11, Node.js 24 LTS                              |

Exact pinned versions are in [`package.json`](./package.json).

## Documentation

- [`docs/backend-architecture.md`](./docs/backend-architecture.md)
- [`docs/database.md`](./docs/database.md)
- [`docs/api.md`](./docs/api.md)
- [`docs/payment-flow.md`](./docs/payment-flow.md)
- [`docs/provenance.md`](./docs/provenance.md)
- [`docs/enode-integration.md`](./docs/enode-integration.md)
- [`docs/security.md`](./docs/security.md)
- [`docs/runbooks.md`](./docs/runbooks.md)
- [`docs/architecture.md`](./docs/architecture.md)
- [`docs/development.md`](./docs/development.md)
- [`docs/domain-overview.md`](./docs/domain-overview.md)

## Production readiness

**Not production-ready yet.** This is a **demo / hackathon vertical slice** with
solid structure and fail-closed guards — not a production deployment checklist.

| Area                          | Ready? | Notes                                                             |
| ----------------------------- | ------ | ----------------------------------------------------------------- |
| Circle 402 → settle → deliver | Code   | Needs live Circle facilitator + Arc RPC + funded Gateway wallet   |
| Enode webhook ingest          | Code   | Needs real Enode webhook secrets + running worker/DB              |
| Enode HTTP API sync           | No     | `EnodeClient` still fail-closed                                   |
| BatchAnchor provenance        | No     | Deliveries report `PENDING`; do not claim `ANCHORED`              |
| Buyer signing in prod         | No     | Env private key forbidden in prod; KMS/reference still deferred   |
| Rate limiting on agent APIs   | No     | Bucket helper exists; not mounted on routes                       |
| Strict provenance gating      | No     | `PROVENANCE_DELIVERY_MODE` env exists; not enforced on delivery   |
| Separate BE/FE repos          | No     | Monorepo by design for now                                        |
| CI with real Circle funds     | No     | Use facilitator doubles / `ALLOW_MOCK_ADAPTERS` in test/demo only |

`pnpm validate` covers format/lint/typecheck/unit/build. Integration tests need
Postgres (`pnpm services:up && pnpm test:integration`).

## Security

Never commit secrets, private keys, seed phrases, webhook secrets, or production
`.env` files. Public defaults live in `.env`; server secrets are documented in
`.env.example` and must stay out of `NEXT_PUBLIC_*`. Production rejects mock
adapters.
