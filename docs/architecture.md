# Architecture

## Boundaries

Frontend:

```
app/routes → features → shared (components, hooks, lib) → config/utilities
```

Backend:

```
Route Handler → transport → application → domain → infrastructure
```

- Route Handlers (`src/app/api/**/route.ts`) are transport adapters only:
  parse/validate the request, call one application function, map the result
  to a response. No Drizzle/Enode/Circle/Arc calls directly in a route file.
- Application functions (`src/server/application/**`) hold the business
  logic and own transactions. They take a `Database` handle and plain input,
  return plain output — no `NextRequest`/`NextResponse`.
- Infrastructure (`src/server/infrastructure/**`) wraps every external
  system: Postgres (`db/`), Circle DCW (`circle/`), Enode (`enode/`), Arc/
  viem (`blockchain/`), the session JWT (`auth/`).

## Request flow (Circle login → Enode link → Arc mint → globe)

1. Browser: Google Sign-In → `credential` (id_token) →
   `POST /api/v1/dashboard/session { googleIdToken }`.
2. Route → `verifyGoogleIdentity` (JWKS) → `bindDashboardOwner` →
   `ensureCircleWalletForPrincipal` (Circle SDK, `refId`-keyed, idempotent) →
   upsert `principals`/`wallets`/`principal_wallets` → sign the dashboard
   session JWT → set as an httpOnly cookie.
3. Every other route in this app reads that cookie
   (`requirePrincipal`/`getCurrentPrincipal`) instead of trusting anything
   from the request body — the wallet id/address in the session is the only
   source of truth for "who is asking."
4. `POST /api/v1/vehicle-onboarding/link` → `createVehicleLink` → Enode
   client-credentials token → Enode `POST /users/:id/link` → pending
   connection row, redirect to Enode's hosted Link UI.
5. OEM login → redirect to `/enode/complete?pendingId=...` →
   `oauth/enode-complete` → `pending/:id/complete` → `finalizePendingVehicle
Connection` upserts the `devices` row (unique on `(provider,
external_device_id)`) and enqueues a `MINT_DEVICE_NFT` outbox event.
6. `src/worker/index.ts` polls `outbox_events` → `mintDeviceNftIfNeeded` →
   claim-before-mint → viem `writeContract` on the already-deployed
   DeviceNFT contract → `devices.mint_status` `pending` → `minted`.
7. Enode webhook (`POST /api/webhooks/enode`) → HMAC-SHA1 verify → dedupe on
   `(provider, delivery_id)` → update `devices.last_latitude/longitude`.
8. `/globe` → `GET /api/v1/dashboard/devices/locations` (paginated, wallet-
   scoped) → Mapbox GL globe, one pin per device with a known location.

## Why this data model is smaller than a typical "EV platform"

This milestone is four steps: register/login, connect a device, mint it,
see it on a map. There is no payment flow, no telemetry history, no
content-hash provenance chain, no agent, no admin panel — so there's no
`payment_requirements`/`ledger_entries`/`telemetry_records`/`anchor_batches`
table set. See [CLAUDE.md](../CLAUDE.md) for what's explicitly out of scope
and why re-adding any of it is a deliberate decision, not a default.
