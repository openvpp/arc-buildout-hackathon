# Demo runbook

## Prerequisites

Fill in `.env.local` (copy from `.env.example`):

- **Database**: a local Postgres (`pnpm services:up`, or point `DATABASE_URL`
  at an existing instance) + `TEST_DATABASE_URL` for integration tests.
- **Circle**: `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET` (Web3 Services
  Console — Developer-Controlled Wallets). `CIRCLE_WALLET_SET_ID` is
  optional; one is found-or-created automatically if unset.
- **Google (optional)**: `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` shows a
  "Continue with Google" button in the sign-in popup as a convenience;
  leave unset and the popup just shows the email field, no loss of
  functionality.
- **Enode**: sandbox `ENODE_CLIENT_ID`/`ENODE_CLIENT_SECRET`, and register
  `ENODE_REDIRECT_URI=http://localhost:3000/enode/complete` in the Enode
  developer console. `ENODE_WEBHOOK_SECRET` if testing the webhook (Enode
  needs a publicly reachable URL for real webhook delivery — use a tunnel
  for local testing, or `scripts/send-dummy-enode-webhook.ts`-style manual
  POSTs).
- **Arc**: `USE_ARC_NETWORK=true`, `ARC_RPC_URL`, `DEVICE_NFT_CONTRACT_ADDRESS`
  (already deployed at `0xf1AB69B6C1eAddCf47C6019805Ac37F2d78FA908` on Arc
  testnet, chain `5042002`), and a funded `PRIVATE_KEY` /
  `DEVICE_NFT_MINTER_PRIVATE_KEY` for the minter account.
- **Mapbox**: `NEXT_PUBLIC_MAPBOX_TOKEN` from a Mapbox account.

## Running it

```bash
pnpm install
pnpm db:migrate
pnpm dev            # terminal 1
pnpm worker:dev      # terminal 2 — mints run here, not in the request
```

## End-to-end walkthrough

1. Open `http://localhost:3000` — the globe is already visible (it never
   gates on sign-in). Click **Sign in** (top right) to open the popup, then
   either **Continue with Google** (if configured) or type an email and
   **Create Wallet**. Confirm the `ev_dashboard_session` cookie is set and
   `/devices` shows an empty state for a fresh principal (not "sign in").
2. **Add vehicle** → optionally set a brand → **Connect with Enode** →
   complete the OEM sandbox login → land back on `/enode/complete` → name
   the vehicle → **Save device**.
3. `/devices` should show the new device with `mint_status: pending`.
4. With the worker running, watch it pick up the `MINT_DEVICE_NFT` job;
   `/devices` should move to `mint_status: minted` with a transaction link
   that resolves on `testnet.arcscan.app`.
5. Send (or wait for) an Enode webhook with a `location` payload for that
   vehicle; `/` (home) should show a pin at that location. Click it → popup →
   **View device** → lands on the same device detail page.

## Duplicate-link / retry checks

- Re-run step 2 for the **same** vehicle: `/devices` should still show one
  row, not two (`devices_provider_external_device_uidx`).
- Kill the worker mid-mint (after it's claimed a device but before
  confirmation) and restart it: the device should reconcile against the
  broadcast tx instead of minting a second NFT
  (`mintDeviceNftIfNeeded`'s `reconcileMint` path — covered by
  `test/integration/device-mint-concurrency.test.ts`).
- A device with no reported location never appears on `/` (home), but still
  shows normally on `/devices`.

## Automated coverage

```bash
pnpm validate          # lint, format:check, typecheck, unit tests
pnpm validate:backend  # lint, typecheck, integration tests (needs Postgres)
pnpm test:e2e           # Playwright — covers the unauthenticated surface only;
                         # the signed-in path needs real provider credentials
                         # and is exercised manually per this runbook
```
