# CLAUDE.md

Engineering contract for Claude Code and other AI coding agents working in
this repository. Read this file fully before modifying anything.

## Project purpose

This repository (`accelerator-milestone1` branch) is a **hackathon
accelerator milestone**: a single, small, end-to-end flow on top of Arc
testnet.

Scope (and only this):

1. A user **registers or logs in** via a **Circle developer-controlled
   wallet**, proven with Google-verified identity. The wallet is created and
   held server-side — no Circle secret, entity key, or private key ever
   reaches the browser.
2. The authenticated user **connects a vehicle via Enode Link**.
3. The device is **minted as a DeviceNFT on Arc testnet**, and the app tracks
   and displays the mint status and transaction accurately
   (`unminted → pending → minted | failed`), never claiming a mint is
   complete before the on-chain transaction is confirmed.
4. The user's devices with known coordinates appear as pins on a **Mapbox
   globe**.

### Explicitly out of scope

No telemetry-nanopayment marketplace, no Circle Gateway x402 payments, no
content-hash/provenance anchoring, no demo agent, no admin panel, no ledger,
no Smartcar/Chargemap/OpenChargeMap, no Circle Paymaster, no external-wallet
connect buttons (MetaMask/Coinbase/WalletConnect/etc.), no ScanContent
screens, no operator/fleet-ops features. Do not reintroduce any of this
without an explicit product decision — it was deliberately left out to keep
this milestone small.

### The frontend is never the source of truth

The dashboard is a **viewer**. It is never authoritative for wallet identity,
device ownership, or mint status — that lives in Postgres, written only by
the server. On-chain state shown here is independent evidence, not
authorization.

## Commands

```bash
pnpm dev                 # Next.js web/API
pnpm worker:dev          # background outbox worker (mint jobs)
pnpm services:up         # Docker Compose Postgres (or use a local Postgres)
pnpm db:migrate          # apply SQL migrations (explicit step)
pnpm db:generate         # generate a new migration from schema changes
pnpm db:seed             # demo seed
pnpm build / start
pnpm lint / lint:fix
pnpm format / format:check
pnpm typecheck
pnpm test                # unit tests
pnpm test:unit
pnpm test:integration    # requires Postgres
pnpm test:e2e            # Playwright
pnpm validate             # lint + format:check + typecheck + unit tests
pnpm validate:backend     # lint + typecheck + integration tests
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

- Pages and layouts stay **thin**; business logic lives in `features` / `lib`
  / `server/application`.
- Components **do not** call external APIs directly (no `fetch` in
  components).
- Route Handlers **do not** contain business logic or call Drizzle/Enode/Arc
  directly.
- Untrusted external data is **validated with Zod** at the boundary.
- Features may consume shared modules; **shared modules must not import
  features**.
- Domain/application layers **must not import Next.js or React**.
- Public env: `src/config/env.ts` only. Server env: `src/server/config/env.ts`
  only.
- Server-only values must **never** be exposed via `NEXT_PUBLIC_*`.
- Circle entity secret, Circle API key, Enode client secret, and the Arc
  minter private key must **never** be in the frontend bundle.

## Backend rules (mandatory)

### Architecture

- Route Handlers are transport adapters only.
- Route Handlers never query PostgreSQL directly.
- Domain and application layers cannot import Next.js.
- Background jobs (`src/worker`) must be idempotent.
- Mint transactions vs. any future provenance transactions are distinct
  concepts — do not conflate a settlement/payment hash with an on-chain
  event hash if either is ever added back.

### Database

- Every schema change requires a committed migration
  (`drizzle/migrations/*`).
- Never use schema push in production.
- Do not edit an applied migration — add a new one.
- Add constraints, not only application checks.
- Avoid unbounded queries; every list endpoint requires pagination.
- Do not mutate a `devices` row's `nft_token_id` once minted.

### Identity & wallets

- Never trust a client-provided wallet address for anything privileged —
  the wallet is resolved server-side from the verified Google identity, not
  from request body fields.
- One principal (email) maps to exactly one Circle wallet, found-or-created,
  never re-created on repeat login.
- Never conflate the Circle wallet address with the Arc DeviceNFT contract's
  address, or with the Arc minter's own signing key.

### Enode

- Verify webhook authenticity before processing.
- Deduplicate webhook deliveries (`webhook_deliveries`, unique on
  provider + delivery id).
- Unknown event types must not crash ingestion.
- Never log complete webhook bodies by default.
- Device ownership/disconnect logic must be scoped by `(provider,
external_device_id)`, never by wallet/user id alone — a known bug in an
  earlier implementation deactivated unrelated devices because disconnect
  wasn't vendor-scoped. Do not repeat that.
- Re-linking the same physical vehicle must not create a duplicate `devices`
  row (`devices_provider_external_device_uidx`).

### Arc minting

- Mint using the already-deployed DeviceNFT contract
  (`DEVICE_NFT_CONTRACT_ADDRESS`) — do not redeploy without an explicit
  decision to do so.
- Claim-before-mint: only one worker attempt may hold a device's mint job at
  a time (`mint_status='pending'` + `mint_claimed_at` lease).
- Persist the broadcast transaction hash **before** confirmation, so a crash
  after broadcast reconciles against the in-flight tx instead of minting a
  duplicate NFT.
- Never present `mint_status` as `minted` in the UI before the transaction is
  confirmed on-chain.

### Security

- No secrets in source control.
- No private keys in frontend code.
- No mock verification presented as real in production.
- No broad CORS.
- No sensitive values in logs.
- No raw internal errors in API responses.
- Use idempotency for financial/on-chain writes (mint jobs).

### Testing

- Use PostgreSQL for database integration tests.
- Add concurrency tests for the claim-before-mint path.
- Test webhook dedup and vendor-scoped disconnect explicitly.
- Never use real funds/mainnet in automated tests.

## Coding rules

- Strict TypeScript. **No `any`.** Use `unknown` at untrusted boundaries and
  narrow with schemas / predicates / discriminated unions.
- **No** `@ts-ignore` / `@ts-expect-error` / suppressed type errors without a
  written explanation.
- **No** disabled ESLint rules without a narrow, inline, explained
  `// eslint-disable-next-line <rule> -- reason` comment.
- **No** `console.log` in application code — use `src/lib/logger` (frontend)
  or `src/server/infrastructure/logging` (backend). No silent error
  swallowing.
- **No** default exports except where a framework convention requires them.
- Schema-validate all external data. Render explicit
  loading/empty/success/error states in the UI.
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
- Long-running work belongs in `src/worker`, not inside HTTP request
  lifecycles.

## Agent workflow

1. Read this `CLAUDE.md`.
2. Inspect the relevant existing files.
3. Identify the architectural boundaries involved.
4. Make the **smallest coherent change**.
5. Add or update tests.
6. Run targeted checks.
7. Run `pnpm validate` and/or `pnpm validate:backend` as appropriate.
8. Report the changed files and the validation results.
9. **Never claim a check passed unless it was actually executed.**
10. Explicitly disclose any checks that could not be run.

## Prohibited actions

- Committing secrets, or adding private wallet keys / seed phrases.
- Fabricating blockchain verification or device data; treating mock data as
  real.
- Silently falling back to mocks in production.
- Disabling lint or type checking globally.
- Installing dependencies without explaining their purpose.
- Broad refactors unrelated to the current task.
- Reintroducing anything listed under "Explicitly out of scope" above
  without a deliberate decision to do so.

## Key files

- `src/config/env.ts` — public env only.
- `src/server/config/env.ts` — server secrets/config.
- `src/server/infrastructure/db/schema/index.ts` — Drizzle schema (source of
  truth for the data model).
- `src/worker/index.ts` — background worker (mint jobs via outbox).
- `docs/` — architecture, database, Enode integration, demo runbook.
