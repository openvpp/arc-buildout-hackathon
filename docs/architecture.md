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

1. Browser: sign-in popup (`CircleAuthModal`) takes an email and password.
   Create account and sign in are separate submits. A wallet address is
   not accepted. The globe stays public.
2. Route → `registerWithPassword` / `signInWithPassword` checks the
   password hash, or `signInWithGoogle` verifies the ID token (`aud` is
   this app's client id, signature against Google's certs,
   `email_verified`) → `bindDashboardOwner` →
   `ensureCircleWalletForPrincipal` (Circle SDK, `refId`-keyed, idempotent)
   → upsert `principals`/`wallets`/`principal_wallets` → sign the dashboard
   session JWT → set as an httpOnly cookie. Password hashes live in
   `dashboard_password_credentials`.
3. Every other route that acts on a wallet reads that cookie
   (`requirePrincipal`/`getCurrentPrincipal`) instead of trusting anything
   from the request body — the wallet id/address in the session is the only
   source of truth for "who is asking." The one exception is step 8: the
   globe's locations endpoint is deliberately public, since it's a fleet-wide
   view, not a per-wallet one.
4. `POST /api/v1/vehicle-onboarding/link` → `createVehicleLink` → Enode
   client-credentials token → Enode `POST /users/:id/link` → pending
   connection row, redirect to Enode's hosted Link UI.
5. OEM login → redirect to `/enode/complete?pendingId=...` →
   `oauth/enode-complete` → `pending/:id/complete` → `finalizePendingVehicle
Connection` upserts the `devices` row (unique on `(provider,
external_device_id)`) and enqueues a `MINT_DEVICE_NFT` outbox event.
6. `src/worker/index.ts` polls `outbox_events` → `mintDeviceNftIfNeeded` →
   claim-before-mint → viem `writeContract` on the already-deployed
   DeviceNFT contract → `devices.mint_status` `pending` → `minted`. A worker
   crash returns a `processing` job to the queue after the lock lease. If a
   transaction hash was already stored, the next attempt reconciles that
   transaction instead of broadcasting another mint. A `busy` or
   unconfigured attempt stays queued; it is not marked complete.
7. Enode webhook (`POST /api/webhooks/enode`) → HMAC-SHA1 verify → dedupe on
   `(provider, delivery_id)` → under a device row lock: update
   `devices.last_latitude/longitude`, fold `odometer` into
   `odometer_readings`/`daily_odometer`, and advance `charging_sessions`
   from `chargeState`. A completed session queues a `device_events` row and
   a `RECORD_DEVICE_EVENT` outbox job in the same transaction.
8. The worker publishes each `device_events` row with `recordDeviceEvent`
   (same claim / persist-hash-at-broadcast / reconcile rules as minting) and,
   once a minute, finalizes finished UTC days (queuing one daily
   `TRIP_COMPLETED` event each) and closes stale charging sessions.
9. `/` (home) → `GET /api/v1/dashboard/devices/locations` (paginated, public
   — every device with a known location, not scoped to a wallet) → Mapbox GL
   globe, one pin per device.
10. `/devices/:id` → the device's on-chain timeline (also
    `GET /api/v1/dashboard/devices/:id/events`, owner-only, paginated), with
    each event's status, explorer link, and the exact published payload and
    hash.

## Why this data model is smaller than a typical "EV platform"

This milestone is: register/login, connect a device, mint it, see it on a
map, and publish its charging sessions and daily mileage as an on-chain time
series. Telemetry history is limited to what that series needs
(`charging_sessions`, `odometer_readings`, `daily_odometer`,
`device_events`). There is no payment flow, no content-hash provenance
chain, no agent, no admin panel — so there's no
`payment_requirements`/`ledger_entries`/`anchor_batches` table set. See [CLAUDE.md](../CLAUDE.md) for what's explicitly out of scope
and why re-adding any of it is a deliberate decision, not a default.
