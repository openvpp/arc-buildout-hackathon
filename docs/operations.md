# Operations

Deploy notes for this milestone. External accounts (Circle, Enode, Arc,
Mapbox) are still required; this app does not replace them.

## What has to be true before traffic

- `APP_ENV=production` (or `staging`).
- `ALLOW_MOCK_ADAPTERS=false`. Startup refuses `true` in those environments.
- `API_KEY_HASH_SECRET` is at least 32 random characters. It signs the
  `ev_dashboard_session` cookie. Rotating it signs every current session out.
- `DATABASE_URL` points at Postgres with `DATABASE_SSL_MODE=require` when the
  database is not on localhost.
- Arc network settings agree: `ARC_CHAIN_ID` and `NEXT_PUBLIC_ARC_CHAIN_ID`
  are equal (5042 = mainnet, 5042002 = testnet), `ARC_RPC_URL` is set for
  mainnet, and `CIRCLE_WALLET_BLOCKCHAIN` is not a testnet chain on mainnet.
  The server refuses to start if any of these disagree. The explorer URL,
  device network label and consent copy follow the chain id.
- Circle, Enode, and the Arc minter key are set only on the server and the
  worker. `NEXT_PUBLIC_*` values are the Mapbox token, the Arc explorer base
  URL, and the optional Google client id.
- The worker (`pnpm worker:dev` locally, the same `src/worker/index.ts`
  process in production) is running. It handles both `MINT_DEVICE_NFT` and
  `RECORD_DEVICE_EVENT` jobs; neither runs inside an HTTP request.
- The Arc signer (`DEVICE_NFT_MINTER_PRIVATE_KEY`) holds both `MINTER_ROLE`
  and `UPDATER_ROLE` on `DEVICE_NFT_CONTRACT_ADDRESS`. Without
  `UPDATER_ROLE`, every `recordDeviceEvent` reverts at gas estimation and
  device events end up `failed`. Check with `hasRole(UPDATER_ROLE, signer)`.
- `ELECTRICITY_PRICE_USD_PER_KWH` is the tariff published as
  `electricityPrice` (default 0.12).
- Address geocoding works: `MAPBOX_GEOCODING_TOKEN` (or the public token)
  is set, and `MAPBOX_PERMANENT_GEOCODING=true` on a Mapbox account that
  allows storing results. Onboarding requires an address, so if geocoding
  is down, new vehicles can't be finished (the wizard stays open to retry).
- Set `LOCATION_OBFUSCATION_SECRET` (or keep `API_KEY_HASH_SECRET` stable).
  Changing it moves live-location pins on the public globe.
- Enode's webhook target is a public `POST /api/webhooks/enode`, and
  `ENODE_WEBHOOK_SECRET` matches the Enode console. Unsigned deliveries are
  rejected.

## Migrations

```bash
pnpm db:migrate
```

Apply migrations before starting the app version that expects them. The
current extra migration adds:

- `outbox_events.locked_at` (nullable)
- a partial unique index so a device has at most one active mint job
- an index for the public globe location query

`0003_onchain_time_series` adds `charging_sessions`, `odometer_readings`,
`daily_odometer` and `device_events`. It only creates new tables.

Milestone 3 adds `0006_event_record_commitment` (new nullable columns +
`payload_version` default 1, so existing rows stay v1),
`0007_event_verifications`, `0008_admin_accounts` and
`0009_chain_event_index`. All are additive.

If the unique index fails, two `pending` or `processing` mint jobs exist for
the same device. Keep one, delete or complete the other, and run migrate
again. Do not edit an already-applied SQL file.

## Rollback

1. Stop the new app and worker.
2. Start the previous app and worker.
3. Leave the new column and indexes in place. The previous code does not
   read `locked_at`. Dropping the column while the new worker is still
   running will crash job claims.

The session cookie format did not change. A deploy does not, by itself,
sign users out.

## Health

| Path                    | Meaning                                               |
| ----------------------- | ----------------------------------------------------- |
| `GET /api/health`       | Process is up. Does not touch Postgres.               |
| `GET /api/health/ready` | Postgres answered `select 1`. Use this for readiness. |

## Verification and admin (milestone 3)

- `ADMIN_PASSWORD` must be set to a strong, non-default value on
  staging/production (the server refuses to start otherwise). Username is
  fixed: `Admin`. Changing the env value rotates the stored hash on the
  next login.
- `ARC_TRUSTED_WRITER_ADDRESSES`: writers whose anchors verify (defaults to
  this app's signer). Add any other legitimate writer here.
- `VERIFIER_RPC_URL` (optional): a different provider than the writer, for
  independence. The public Arc RPCs work but are rate-limited and drop the
  tx-hash index for old transactions (verification reads by block).
- `ARC_EXPLORER_API_URL` (optional): used only by **Sync from chain**. The
  mainnet explorer may block server requests (403); the forward scanner
  still indexes new events from the RPC.
- `VERIFICATION_MAX_ANCHOR_DELAY_HOURS` (default 48): anchors later than
  this after the activity — or after the DeviceNFT mint, for records held
  until it — are flagged `verified_with_warnings`. Keep it above the 24 h
  stale-session window.
- Re-check one record from a shell: `pnpm verify:event -- <deviceEventId>`.

## Device events (on-chain time series)

- One worker processes jobs sequentially with a single signer, so mint and
  event transactions never race for a nonce. Running several workers with
  the same key can produce `nonce too low` errors; those are retried, but
  prefer one worker per signer.
- Each `recordDeviceEvent` costs about 45k gas (~0.001 USDC on Arc).
- An event for an unminted device waits (`queued`, retried every 5 minutes)
  until the mint confirms. It is never dropped.
- Once a minute the worker also finalizes finished UTC days (30 minutes
  after midnight) and closes charging sessions with no update for 24 hours.
  Both sweeps take at most 100 rows per run and are safe to run from
  several workers.
- `pending` with a `transaction_hash` means broadcast but not yet confirmed;
  the worker reconciles it from the receipt and never re-broadcasts it.
- A receipt that succeeded but whose `DeviceEvent` log does not match the
  row fails the event, keeps that transaction hash, and is not sent again.
- Verify a row on-chain: the tx's `DeviceEvent` log must carry the row's
  `token_id` and `event_type`, and `keccak256(data)` must equal
  `payload_hash`.

## Limits that are in the app

- Session creation, vehicle link, and finalize are rate limited in process
  memory (per instance, not across a fleet of servers). Put a shared limiter
  in front if you run more than one web process.
- JSON bodies are capped at 16 KiB. Enode webhook bodies are capped at 256 KiB.
- The globe loads located devices in pages of 200, up to 25 pages per refresh.

## Still external

Circle wallet creation, Enode Link, Arc RPC, Mapbox, and Google sign-in are
live dependencies. A missing Circle or Enode credential fails that action
with a client-safe error; it does not fall back to a fake wallet or a fake
mint. Sign-in accepts an email and password. The globe does not require sign-in.
