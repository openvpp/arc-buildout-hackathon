# CLAUDE.md

Engineering contract for Claude Code and other AI coding agents working in
this repository. Read this file fully before modifying anything.

## Project purpose

This repository (`accelerator-milestone3` branch) is a **hackathon
accelerator milestone**: a single, small, end-to-end flow on top of Arc.
Development and automated tests run on Arc testnet; the target network
(testnet or mainnet) is deployment configuration (`ARC_CHAIN_ID`,
`ARC_RPC_URL`, `DEVICE_NFT_CONTRACT_ADDRESS`), never hardcoded.

Scope (and only this):

1. A user **registers or logs in** and the server creates or reopens a
   **Circle developer-controlled wallet**. Email and password is the
   sign-in path: the password is hashed on the server, and the email is
   only the account key. Creating an account and signing in are separate,
   and a password cannot be added to an account that already exists. The
   wallet is created and held server-side — no Circle secret, entity key,
   or private key ever reaches the browser.
2. The authenticated user **connects a vehicle via Enode Link** and enters
   the **address** where it is usually kept (required at onboarding,
   editable later by the owner). The address is personal data: only the
   owner sees it; the public globe shows the device at a stable point
   0.5–2 km away; it is never published on-chain.
3. The device is **minted as a DeviceNFT on Arc**, and the app tracks
   and displays the mint status and transaction accurately
   (`unminted → pending → minted | failed`), never claiming a mint is
   complete before the on-chain transaction is confirmed.
4. Every device with a known location — across every wallet — appears as a
   pin on a **Mapbox globe**, always at an approximate (0.5–2 km offset)
   point, never the exact one. The globe is a public, fleet-wide view: its
   `GET /api/v1/dashboard/devices/locations` endpoint is deliberately
   unauthenticated, unlike every other route in this app.
5. **On-chain time series** (milestone 2). Each device's charging sessions
   and daily odometer are stored in full off-chain (Postgres), and a
   whitelisted, non-sensitive subset is published on-chain via the
   DeviceNFT's `recordDeviceEvent`: `CHARGING_COMPLETED` (eventType 2) per
   completed session and `TRIP_COMPLETED` (eventType 12) per device per UTC
   day. The owner sees the timeline with each event's on-chain status.
6. **Independent verification** (milestone 3, the M&V layer). Anyone — or
   any agent — can confirm a record on-chain: the anchor exists, it was
   written by an authorized writer, the content hash matches, and it was
   anchored on time → `verified` / `verified_with_warnings` / `unverified`
   / `pending`. New payloads (v2) carry `recordHash`, a salted commitment to
   the full off-chain record. Public: `/verify`, `GET|POST /api/v1/verify*`
   (deliberately unauthenticated, rate-limited), `docs/verification-spec.md`,
   and `scripts/verify-standalone.ts` (no trust in this app).
7. **Admin console** at `/admin` (same domain): a separate admin role with
   one fixed `Admin` account, password from `ADMIN_PASSWORD`. The admin sees
   every device and its data (including exact address), reconciles each
   device's records with the chain, and can re-verify on demand.

### Explicitly out of scope

No telemetry-nanopayment marketplace, no Circle Gateway x402 payments, no
content-hash/provenance anchoring of files or content (the device event time
series in scope item 5 is the only on-chain data besides mints; milestone 3
verification only reads the chain), no points or rewards system, no trip
detection beyond the daily odometer roll-up, no demo agent, no admin
features beyond the M&V console in scope item 7, no ledger,
no Smartcar/Chargemap/OpenChargeMap, no Circle Paymaster, no external-wallet
connect buttons (MetaMask/Coinbase/WalletConnect/etc.), no ScanContent
screens, no operator/fleet-ops features. The agentic USDC nanopayment
per-query layer (and its static payer wallet) is milestone 4 — not here. Do not reintroduce any of this
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

- Never trust a client-provided wallet **address** for anything privileged.
  Password sign-in checks a server-side password hash. Google sign-in
  verifies the ID token and uses the email inside it. The request body has
  no wallet-address field.
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
- `typeId` is resolved from `devices.device_type` via the standardized
  on-chain taxonomy in `device-types.ts` (source of truth shared with the
  deployed contract) — never hardcode or configure it as a flat value.
  Adding a new entry there is a contract-compatibility decision, not a
  routine config change; don't renumber existing entries.
- Claim-before-mint: only one worker attempt may hold a device's mint job at
  a time (`mint_status='pending'` + `mint_claimed_at` lease).
- Persist the broadcast transaction hash **before** confirmation, so a crash
  after broadcast reconciles against the in-flight tx instead of minting a
  duplicate NFT.
- Never present `mint_status` as `minted` in the UI before the transaction is
  confirmed on-chain.

### Device addresses and public location

- The browser sends address **text** only; the server geocodes it
  (`mapbox-geocoder.ts`). Never accept client-supplied coordinates.
- Exact coordinates and address text never leave owner-only and admin-only
  reads. The public globe gets `device_addresses.public_*` or, for a device without an
  address, its live location passed through `obfuscateCoordinates`. Never
  return `devices.last_latitude/longitude` from a public endpoint.
- The offset is keyed (HMAC) and stable per device/address so repeated
  requests can't be averaged back to the real point. Don't randomize per
  request and don't shrink the 0.5 km minimum.
- Never log addresses or geocoder URLs (they carry the token).
- Storing Mapbox results requires `MAPBOX_PERMANENT_GEOCODING=true` (a
  billed Mapbox option); `geocoded_permanent` records which mode was used.

### Independent verification (M3)

- Verification only **reads** the chain. Never write verification results
  on-chain, and never change or redeploy the DeviceNFT contract for it.
- Read anchors **by block** (`eth_getLogs` at the stored block, sender from
  the block's transactions), not by tx hash: Arc's public RPCs drop the
  hash index for older transactions. Retry `requested data not available`
  (the RPC load-balances over nodes with different history). Log ranges
  must stay ≤ 2,000 blocks.
- The contract admits any `UPDATER_ROLE` holder; only senders in
  `ARC_TRUSTED_WRITER_ADDRESSES` (default: this app's signer) may verify.
- Never mark an event verified from our own publish receipt; verdicts come
  from `verifyDeviceEvent` (pure) and are stored in `event_verifications`.
  A verdict is never recorded when the chain could not be read.
- Values a check relies on (`recordHash`, `endTime`) are read from the
  anchored bytes, never from a database copy. Lateness counts from
  max(activity end, `devices.nft_minted_at`); keep the limit above the 24 h
  stale-session window.
- A chain read failure throws (`VERIFICATION_UNAVAILABLE`); only "the block
  does not exist" counts as missing. Records are only re-checked on the
  chain and contract they were anchored on.
- Payload v2 (`recordHash`) is frozen at queue time with a random salt;
  the salt and `record_json` are off-chain only and never returned by any
  public endpoint. Never rebuild or rehash a stored payload.
- Verify jobs never block on-chain writes: the worker claims mint/publish
  jobs first, the chain scan has its own interval and time budget, and only
  history misses are retried in the reader. An exhausted verify job backs
  the record off (`verification_next_check_at`) instead of re-queueing
  every minute. Admin "Verify all" only enqueues.
- Discovery (scanner, explorer) is never proof. Everything shown as
  verified is re-checked against an RPC.
- Public verify routes are deliberately unauthenticated (like the globe)
  and must stay rate-limited; a forced re-read has its own tighter limit.
  A plain public view never reads the chain except for a record's first
  check; a stale verdict queues a worker job (respecting backoff).
- Say plainly what verification proves: anchored, attributable, unchanged,
  timely — not that the measurement is true.

### Admin console

- Separate role: `admin_accounts` (fixed `Admin`), its own session cookie
  (`ev_admin_session`, path `/admin`, its own JWT subject). Never accept a
  dashboard session for admin or vice versa.
- `ADMIN_PASSWORD` is only ever stored as a hash. Empty disables the
  console (404). When set, staging/production refuse the demo default
  (`Admin123`) or a < 12-character password.
- Middleware gates `/admin` by signature only and never redirects the
  login page or a server-action POST (the page / action decides).
  Protected layouts and server actions re-check the account and the
  session's credential version (an HMAC of the current password), so a
  password change ends every session. Admin actions are attributed
  (`admin:<username>`).
- Rate limits key on the client IP from `clientAddress` (trusted proxy
  hops), never the first `X-Forwarded-For` entry.
- Never log attempted passwords.

### On-chain device events

- Publish only through `device_events` + the outbox worker, never inline in
  a webhook/request. One row per `(source_type, source_id, event_type)`.
- The on-chain payload is built by a pure, whitelisted builder with a fixed
  key order. Store the exact JSON string sent (`payload_json`) and its
  keccak256 (`payload_hash`); never rebuild a payload after creation.
- **Never publish location**, user identity, wallet address, or raw
  provider payloads. `vehicleId` on-chain is our `devices.id`, not the
  Enode vehicle id.
- `method` must state how energy was obtained (`direct_kwh` only for a
  provider-reported kWh, otherwise `estimated_from_battery_change`). Never
  label an estimate as measured. `electricityPrice` is a configured tariff.
- Events for an unminted device stay `queued` until the mint confirms; never
  drop them. Persist the tx hash before confirmation, reconcile on retry.
- Never show an event as `confirmed` before its receipt is confirmed.
- `recordDeviceEvent` requires the signer to hold `UPDATER_ROLE` on the
  contract (minting requires `MINTER_ROLE`).
- Odometer is stored in km; the published daily payload uses miles to match
  the existing on-chain series.

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
- Add concurrency tests for the claim-before-mint path and the device-event
  publish path.
- Verification tests use a fake chain reader; never point automated tests
  at mainnet. Cover tampering (payload, private record, writer, backdating).
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
